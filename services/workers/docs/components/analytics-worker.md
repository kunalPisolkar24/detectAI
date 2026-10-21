# Analytics Worker

This document explains how the Analytics worker processes usage events in detail.

## What is the Analytics Worker?

The Analytics worker tracks API usage by processing `usage_event` messages from RabbitMQ. It atomically increments daily and total usage counters in PostgreSQL.

## Why Have a Separate Analytics Worker?

- **Decoupling** — Usage tracking doesn't block API requests
- **Deduplication** — Prevents double-counting from redelivered messages
- **Scalability** — Can handle high-volume usage events independently

## How It Works

The Analytics worker starts in **degraded mode** if PostgreSQL or Redis are not reachable yet. It probes both once at boot, logs a warning if either is down, and carries on — the connection is retried in the background and `/ready` reports the real state until it recovers. Unlike the Payments and Cron workers, it does not loop on the probe at startup.

### Event Schema

Usage events must match this schema:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `eventId` | string (UUID) | yes | Unique event identifier for dedup |
| `userId` | string (at least 1 character) | yes | User who made the API call |
| `count` | positive integer | yes | Number of API calls to count. Must be a JSON **number** — `"1"` is rejected. |
| `timestamp` | string (ISO 8601, UTC only) | no | When the call happened. Must end in `Z`; an offset like `+02:00` is rejected. |
| `event_type` | `usage_event` | no | Event type discriminator |
| `type` | `usage_event` | no | Alternative event type field |

Only the first three fields are required. The two event type fields are optional aliases, so the same message is accepted whether the producer sends `event_type` or `type`.

**"Optional" does not mean "ignored".** The two event type fields are optional but *literal*: if either one is present with a value other than `usage_event`, the whole message fails validation and is dead-lettered.

**A validation failure is one error for every kind of problem.** The worker throws `MissingFieldError` with the message `Missing required field: usage_event: eventId/userId/count failed validation`. The field name in that message is not a real field, and the message is identical whether the event id was malformed, the count was zero, the timestamp was badly formatted or the event type was wrong. The details are only in the `Invalid analytics usage event` warning log, which also echoes the whole event.

### Event Processing Pipeline

```mermaid
graph TB
    A[Receive Event] --> B[Parse JSON]
    B --> C{Preview User?}
    C -->|Yes| D[Drop, log warning]
    C -->|No| E[Validate with Zod]
    E --> F{Valid?}
    F -->|No| G[Throw MissingFieldError]
    F -->|Yes| H[Check Dedup]
    H --> I{Duplicate?}
    I -->|Yes| J[Skip, no-op]
    I -->|No| K[Atomic UPSERT]
    K --> L[ACK]
```

**Preview events are dropped and acknowledged.** A `userId` that starts with `preview-` is dropped before validation, logged as a warning, counted as `worker_cron_stale_events_filtered_total{reason="preview"}`, and acknowledged. The event is gone for good — it never reaches the dead letter queue, so there is nothing to replay.

### Class Structure

The Analytics worker is small on purpose. `RabbitMQWorker` owns the connection and calls `AnalyticsService` through a function callback, and the service does the counting.

```mermaid
classDiagram
    class RabbitMQWorker {
        +start() void
        +shutdown() void
        +getStatus() boolean
    }

    class AnalyticsService {
        +handleUsageEvent(userId, count, eventId) void
    }

    class UsageEventDeduplicator {
        +tryBegin(eventId) boolean
        +release(eventId) void
    }

    class IUserRepository {
        <<interface>>
        +incrementUsage(userId, count) void
    }

    class PrismaUserRepository {
        +incrementUsage(userId, count) void
    }

    class MetricsService {
        +getMetrics() string
    }

    class WorkerServer {
        +start() void
        +stop() void
    }

    IUserRepository <|.. PrismaUserRepository
    RabbitMQWorker ..> AnalyticsService : handler callback
    RabbitMQWorker o-- MetricsService
    AnalyticsService o-- UsageEventDeduplicator
    AnalyticsService --> IUserRepository
    AnalyticsService --> MetricsService
    WorkerServer o-- MetricsService
```

**Where the event schema lives.** The Zod schema is not inside `AnalyticsService` — it sits in `src/cmd/analytics/index.ts`, next to the queue name and the preview-user filter. That keeps the service focused on counting, and means the rules about what a valid message looks like are all in one readable place.

### Deduplication

The Analytics worker uses Redis SET NX for fast, atomic deduplication:

```mermaid
graph TB
    A[Event arrives] --> B[Redis SET NX<br/>analytics:usage:event:EVENT_ID]
    B --> C{Result}
    C -->|OK| D[New event - process]
    C -->|null| E[Duplicate - skip]
    C -->|Redis error| F[Fail-open, process anyway]
```

| Setting | Value | Description |
|---------|-------|-------------|
| Key pattern | `analytics:usage:event:{eventId}` | Per-event dedup key |
| TTL | 7 days (604800s) | Auto-cleanup of old dedup keys |
| Operation | `SET NX EX` | Atomic claim with expiry |

**Fail-open:** If Redis is down, the event is processed anyway. Better to over-count than lose usage data.

### Atomic Usage Increment

The worker increments the counters with a single raw `INSERT ... ON CONFLICT` statement:

```mermaid
graph TB
    A[Increment Usage] --> B[INSERT ... ON CONFLICT userId DO UPDATE]
    B --> C{Is the daily counter stale?}
    C -->|Yes| D[apiCallCountDaily = count]
    C -->|No| E[apiCallCountDaily = apiCallCountDaily + count]
    D --> F[Done]
    E --> F
```

**Why atomic?**
- Prevents race conditions from concurrent events
- No read-modify-write cycle
- Single database operation

**The daily counter resets itself.** The statement compares the row's `lastApiCallReset` marker against today's UTC date. If the marker is `NULL` or falls on an earlier day, the daily counter is **set** to `count` instead of being incremented, so the first event of a UTC day starts the count from scratch. The lifetime total is always incremented.

### No Cache Invalidation

The Analytics worker does **not** invalidate user cache after incrementing usage:

| Cache Key | Why No Invalidation |
|-----------|---------------------|
| `user:basic:*` | Usage counters are not embedded in cached user blobs |
| `user:sub:*` | Usage is separate from subscription status |
| `rate_limit:*` | Counters expire at midnight UTC via TTL, not explicit invalidation |

**Why?**
- Pre-split: usage was embedded in user cache, causing churn on every increment
- Post-split: usage counters are independent, cache staleness is acceptable
- Rate limits reset at midnight UTC anyway

## Error Handling

### Error Classification

| Error | Action |
|-------|--------|
| Invalid event schema | Throw `MissingFieldError` (DLQ) |
| Missing `eventId` | Throw `MissingFieldError` (DLQ) |
| DB unavailable | Infra-requeue (nack with requeue, no retry burn) |
| Transient DB error | Retry via RabbitMQ delayed exchange |
| Redis error (dedup) | Fail-open, process anyway |
| Duplicate event | Silently skip |

**A schema failure never reaches `worker_job_errors_total`.** The validation happens in the queue handler, before the service is called, so the only metric that moves is `worker_dead_lettered_total`. An alert on `worker_job_errors_total{job_type="usage_event"}` stays flat while every message is being dead-lettered for schema reasons.

**The service has its own guard for an empty `eventId`**, in case it is called directly rather than through the queue. It throws the same `MissingFieldError`, so the event is dead-lettered immediately rather than burning the retry budget on a message that can never succeed.

### Dedup Claim Release

If processing fails after claiming dedup, the claim is released:

```mermaid
graph TB
    A[Claim dedup] --> B[Process event]
    B --> C{Success?}
    C -->|Yes| D[Keep claim]
    C -->|No| E[Release dedup claim]
    E --> F[Retry or dead letter]
```

**The claim is released for every error, not just retryable ones.** The increment is a single atomic statement, so a failed attempt means the usage was *not* counted. Keeping the claim would lose that usage permanently — the redelivery would be filtered as a duplicate and the count would stay short.

**If the release itself fails, the usage is lost.** The release is a `DEL` on the dedup key, and its errors are swallowed with a warning. The redelivered event is then filtered as a duplicate and never counted.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` in dev | RabbitMQ connection. Required in prod. |
| `RABBITMQ_PREFETCH` | 1 | Unacked messages per consumer (1-1000) |
| `INFRA_REQUEUE_DELAY_MS` | 5000 | Delay before infra-requeue when the database is down |
| `REDIS_URL` | (required) | Redis for dedup |
| `PORT` | 7777 | Health server port. Docker Compose sets 7001. |

See [Configuration](../getting-started/configuration.md) for the full list of shared settings.

## Metrics

| Metric | What It Tells You |
|--------|-------------------|
| `worker_jobs_processed_total` | Events counted. Duplicates are **not** counted — they are skipped before the increment. |
| `worker_job_errors_total` | Failed events by error type. Schema failures do not appear here. |
| `worker_job_duration_seconds` | Processing time per event, labelled with the outcome |
| `worker_cron_stale_events_filtered_total` | Duplicate events filtered, under `reason="duplicate"`, and preview events dropped, under `reason="preview"` (the `cron_` prefix is in the metric name, but all three workers use it) |
| `worker_dead_lettered_total` | Messages sent to DLQ |
| `worker_retry_total` | Retry attempts |
| `worker_infra_requeued_total` | Infra-requeue count |
| `worker_domain_operations_volume_total` | Total API calls counted |

**The Analytics worker does not emit `cache_operations_total`.** That counter only records cache invalidations, and this worker never invalidates a cache. Dedup activity shows up under `worker_cron_stale_events_filtered_total` instead.

## Troubleshooting

**Events not processing?**
- Check RabbitMQ connectivity
- Verify `analytics.usage` queue exists
- Look at worker logs for connection errors

**Usage counts seem low?**
- Check `worker_cron_stale_events_filtered_total{reason="duplicate"}` — are events being deduped?
- Verify Redis is healthy for dedup
- Check for `MissingFieldError` in logs

**Usage counts seem high?**
- Check for duplicate events in the queue (Paddle or web app may be sending duplicates)
- Dedup is working correctly if `worker_cron_stale_events_filtered_total{reason="duplicate"}` > 0

**High error rate?**
- Check database health
- Look at `worker_job_errors_total` for error types
- Common: DB connection pool exhaustion under high load

## Next Steps

- [Message Flows](../concepts/message-flows.md) - Analytics flow overview
- [Architecture](../concepts/architecture.md) - System design
- [Health](../operations/health.md) - Monitoring the worker
