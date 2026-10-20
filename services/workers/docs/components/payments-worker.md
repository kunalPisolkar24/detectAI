# Payments Worker

This document explains how the Payments worker processes Paddle webhooks in detail.

## What is the Payments Worker?

The Payments worker handles subscription lifecycle events from Paddle. It processes webhooks for subscription creation, updates, activation, cancellation, and user-initiated cancellations.

## Why Have a Separate Payments Worker?

- **Isolation** — Payment processing has unique dependencies (Paddle API, events Redis)
- **Reliability** — Quorum queues ensure no webhook is lost
- **Idempotency** — Duplicate webhooks from Paddle are safely ignored
- **State machine** — Invalid status transitions are rejected

## How It Works

### Event Types

The Payments worker handles these Paddle event types:

| Event Type | Handler | What It Does |
|------------|---------|--------------|
| `subscription.created` | `SubscriptionUpdatedHandler` | Creates/updates subscription with initial status |
| `subscription.updated` | `SubscriptionUpdatedHandler` | Updates subscription status and dates |
| `subscription.activated` | `SubscriptionUpdatedHandler` | Marks subscription as active |
| `subscription.canceled` | `SubscriptionCanceledHandler` | Marks canceled, clears the subscription's Paddle identifiers |
| `user.cancel_subscription` | `UserCancelHandler` | Calls Paddle API to cancel, then updates DB |

### What Each Handler Reads

The three handlers do not read the same fields, and the differences matter when a webhook arrives incomplete.

| Field | `SubscriptionUpdatedHandler` | `SubscriptionCanceledHandler` | `UserCancelHandler` |
|-------|-------------------------------|---------------------------------|---------------------|
| Subscription id | `data.id` | `data.id` | `data.paddleSubscriptionId` |
| Customer id | `data.customer_id` | — | — |
| Plan id | `data.items[0].price.id` | — | — |
| Status | `data.status` | always `CANCELED` | always `CANCELED` |
| `endsAt` | `data.current_billing_period.ends_at`, else `data.scheduled_change.effective_at` | `data.canceled_at` | not set |
| Timestamp | `data.occurred_at` | `data.occurred_at` | `data.occurred_at` |

Producers send the timestamp as `occurred_at` on the event envelope. The worker copies it into `data` before calling a handler, so the handlers always find it there.

**Which missing fields are fatal.** A missing or unreadable value raises a `MissingFieldError` and the message is dead-lettered. There are only a few:

| Field | Result when missing |
|-------|---------------------|
| `userId` | `MissingFieldError` — dead lettered |
| `data.id` | `MissingFieldError` — dead lettered |
| `data.status` | `MissingFieldError` — dead lettered. An unrecognised status is treated the same as a missing one, so `pastdue` (without the underscore) is dead-lettered rather than rejected as an invalid transition. |
| `data.customer_id` | `MissingFieldError` — dead lettered |
| `data.items[0].price.id` | **Not fatal.** A warning is logged, the event is counted as `worker_job_errors_total{job_type="subscription.updated", error_type="missing_planId"}`, and the existing `paddlePlanId` is left untouched. |
| `data.occurred_at` | **Not fatal.** The server clock is used instead. Only a timestamp that is present but unparseable is dead-lettered. |

**A `NULL` `endsAt` keeps the old value.** The repository only overwrites `endsAt` when the handler supplied a non-null one. A cancel event with no `canceled_at` therefore flips the status to `CANCELED` while leaving the previous expiry date in place. A subscription with a `NULL` `endsAt` is never swept by the Cron worker.

### Class Structure

`PaymentService` is the only class that knows about the whole flow. It owns a registry of handlers, keyed by event type, and every handler implements the same one-method interface.

```mermaid
classDiagram
    class PaymentService {
        +handleEvent(event) void
        -resolveEventId(event) string
        -safeEventType(eventType) string
    }

    class IPaymentEventHandler {
        <<interface>>
        +handle(userId, data) void
    }

    class SubscriptionUpdatedHandler {
        +handle(userId, data) void
    }

    class SubscriptionCanceledHandler {
        +handle(userId, data) void
    }

    class UserCancelHandler {
        +handle(userId, data) void
    }

    class IPaddleClient {
        <<interface>>
        +cancelSubscription(subscriptionId) void
    }

    class PaddleClient {
        +cancelSubscription(subscriptionId) void
    }

    class IdempotencyStore {
        +isDuplicate(eventId) boolean
        +release(eventId) void
        +markProcessed(eventId, eventType) void
    }

    class EventDeduplicator {
        +isStale(userId, eventTimestamp) boolean
        +markProcessed(userId, eventTimestamp) void
    }

    class UserCacheInvalidator {
        +invalidateUser(userId, email) void
        +invalidateUsers(users) void
    }

    class IUserRepository {
        <<interface>>
        +findUniqueById(userId) UserRecord
        +lockAndUpdateSubscription(userId, eventTimestamp, status, payload) SubscriptionUpdateResult
    }

    class PrismaUserRepository {
        +findUniqueById(userId) UserRecord
        +lockAndUpdateSubscription(userId, eventTimestamp, status, payload) SubscriptionUpdateResult
    }

    class MetricsService {
        +getMetrics() string
    }

    IPaymentEventHandler <|.. SubscriptionUpdatedHandler
    IPaymentEventHandler <|.. SubscriptionCanceledHandler
    IPaymentEventHandler <|.. UserCancelHandler
    IPaddleClient <|.. PaddleClient
    IUserRepository <|.. PrismaUserRepository

    PaymentService o-- IPaymentEventHandler : handler registry
    PaymentService o-- IdempotencyStore
    PaymentService --> MetricsService

    SubscriptionUpdatedHandler o-- EventDeduplicator
    SubscriptionUpdatedHandler o-- UserCacheInvalidator
    SubscriptionUpdatedHandler --> IUserRepository
    SubscriptionCanceledHandler o-- EventDeduplicator
    SubscriptionCanceledHandler o-- UserCacheInvalidator
    SubscriptionCanceledHandler --> IUserRepository
    UserCancelHandler o-- EventDeduplicator
    UserCancelHandler o-- UserCacheInvalidator
    UserCancelHandler o-- IPaddleClient
    UserCancelHandler --> IUserRepository
```

**Three details worth knowing:**

- **The subscription id field differs by handler.** `SubscriptionUpdatedHandler` and `SubscriptionCanceledHandler` read the Paddle subscription id from `data.id`. `UserCancelHandler` reads it from `data.paddleSubscriptionId`, because `user.cancel_subscription` is published by the web app, not by Paddle.
- **`UserCancelHandler` tolerates a self-transition.** If the subscription is already `CANCELED`, the `CANCELED -> CANCELED` change is treated as an idempotent success rather than an error, so a repeated cancel request does not dead-letter.
- **Only the subscription's Paddle identifiers are cleared.** Cancelling sets `Subscription.paddleSubscriptionId` and `Subscription.paddlePlanId` to `NULL`. The `User.paddleCustomerId` column is left alone — the cancel handlers pass an empty customer id, which the repository ignores, so a canceled user keeps their Paddle customer id.

### Event Processing Pipeline

```mermaid
graph TB
    A[Receive Event] --> B[Parse JSON]
    B --> C[Validate userId]
    C --> C1{Missing?}
    C1 -->|Yes| C2[MissingFieldError<br/>send to DLQ]
    C1 -->|No| D{Event Type Known?}
    D -->|No| E[Log warning<br/>send to DLQ]
    D -->|Yes| F[Check Idempotency]
    F --> G{Duplicate?}
    G -->|Yes| H[Skip, ACK]
    G -->|No| I[Call Handler]
    I --> J{Success?}
    J -->|Yes| K[Mark Processed, ACK]
    J -->|No| L{Retryable?}
    L -->|Yes| M[Retry via Delayed Exchange]
    L -->|No| N[Send to DLQ]
```

**The order matters.** The `userId` is validated *before* the handler is looked up, so a poison message never claims an idempotency key it will never use.

An event type with no registered handler is **dead-lettered**, not acknowledged. It is not written to the permanent ledger, so it stays in the dead letter queue and can be replayed by hand once a handler for it ships. Acknowledging it would drop the event for good.

### Idempotency

Paddle may send the same webhook multiple times. The Payments worker uses a two-layer idempotency system:

```mermaid
graph TB
    A[Event arrives] --> B[Redis SET NX]
    B --> C{Key exists?}
    C -->|Yes| D[Duplicate - skip]
    C -->|No| E[Claim in Redis]
    E --> F[Check DB ProcessedWebhook]
    F --> G{DB has event?}
    G -->|Yes| D
    G -->|No| H[Process event]
    H --> I[Write to DB ProcessedWebhook]
```

| Layer | Storage | TTL | Purpose |
|-------|---------|-----|---------|
| Fast path | Redis (`paddle:evt:EVENT_ID`) | 7 days | Quick duplicate detection |
| Permanent | PostgreSQL (`ProcessedWebhook`) | None — rows stay until deleted | Authoritative record, indexed by `receivedAt` for manual replay |

**Fail-open:** If Redis is down, falls back to the database check. If both fail, processes the event (better to over-process than lose data).

**Where the event id comes from.** The worker uses `event_id` first, then `eventId`, then `notification_id`, then `notificationId`. If the producer supplied none of them, it falls back to a SHA-256 of the event type, its timestamp and its data. The timestamp is part of the hash on purpose: two events with identical data but different timestamps are different events, and hashing the data alone would drop the second one as a duplicate.

**Four things worth knowing about the two layers:**

- **The Redis key is the claim.** There is no separate "check" and "claim" — the `SET NX` that detects a duplicate is the same call that claims the event. A duplicate is simply a key that already exists.
- **If the database check fails after a successful claim, the claim is kept.** The event is processed, but no ledger row is written, and the Redis key blocks a re-delivery for 7 days.
- **Writing the ledger never fails the message.** If the `ProcessedWebhook` insert fails, it is logged and counted as `worker_job_errors_total{job_type="idempotency_persist", error_type="db_error"}`, and the message is acknowledged anyway. The event is then missing from the permanent record — the Redis fast path is the only trace of it, and after 7 days it can be processed again.
- **The claim is only released for retryable errors.** A message that ends up in the dead letter queue keeps its Redis key, so replaying it by hand will be filtered as a duplicate. Delete the key first.

### State Machine

The Payments worker enforces valid subscription status transitions:

```mermaid
stateDiagram-v2
    [*] --> NULL : first webhook for this user
    NULL --> TRIALING : status = trialing
    NULL --> ACTIVE : status = active

    TRIALING --> TRIALING : status = trialing
    TRIALING --> ACTIVE : status = active
    TRIALING --> CANCELED : status = canceled
    TRIALING --> PAST_DUE : status = past_due

    ACTIVE --> ACTIVE : status = active
    ACTIVE --> CANCELED : status = canceled
    ACTIVE --> PAST_DUE : status = past_due
    ACTIVE --> PAUSED : status = paused

    PAUSED --> PAUSED : status = paused
    PAUSED --> ACTIVE : status = active
    PAUSED --> CANCELED : status = canceled

    PAST_DUE --> PAST_DUE : status = past_due
    PAST_DUE --> ACTIVE : status = active
    PAST_DUE --> CANCELED : status = canceled

    CANCELED --> CANCELED : status = canceled
    CANCELED --> ACTIVE : status = active (resubscribe)
    CANCELED --> TRIALING : status = trialing (resubscribe)
    CANCELED --> [*] : terminal
```

**How to read the labels:** every edge is labelled with the `status` value that has to arrive in the Paddle payload for that change to be allowed. The worker reads `data.status`, upper-cases it, and checks it against the current status. Anything not listed here is rejected.

**About the `[*]` end connector:** `CANCELED` is the terminal state of a subscription. It is where a subscription ends up when a customer cancels, and the `[*]` connector marks that end. (The Cron sweeper also leaves rows with a `NULL` status alone, but `NULL` is not a status the state machine knows about.)

`CANCELED` is still not a one-way door. A customer who resubscribes produces a new event with `status = active` or `status = trialing`, which moves the subscription straight back out of `CANCELED` — that is what the two arrows leaving `CANCELED` cover.

The state machine lives in `src/modules/payments/domain/stateMachine.ts`. It is a plain lookup table of `current status -> allowed next statuses`, and it is injected into the repository by the composition root, so the user module never imports the payments rules.

Invalid transitions throw `InvalidTransitionError` and send the event to the DLQ.

### Stale Event Detection

Paddle can deliver webhooks out of order. To stop an old event overwriting a newer one, the worker checks the event timestamp in two places.

```mermaid
graph TB
    A[Webhook arrives] --> B[Parse occurred_at]
    B --> C[Redis: compare with payment:event:ts:USER_ID]
    C --> D{Newer or equal?}
    D -->|No| E[Log stale warning]
    E --> F[Skip processing]
    F --> G[ACK]
    D -->|Yes| H[DB: lock the row and compare eventTimestamp]
    H --> I{Newer or equal?}
    I -->|No| J[Return stale, skip the write]
    I -->|Yes| K[Apply the update]
```

| Layer | Where | What it compares |
|-------|-------|------------------|
| Fast | Redis `payment:event:ts:USER_ID` | The newest timestamp seen for this user (30-day TTL) |
| Authoritative | PostgreSQL `Subscription.eventTimestamp` | The timestamp stored on the row, read under a `FOR UPDATE` lock |

**The two layers disagree about equal timestamps, and the database wins.**

- **Redis** treats only a *strictly* older timestamp as stale. Paddle sends second-level precision, so two genuinely different events can share a timestamp, and the Redis layer lets both through.
- **The database** additionally drops an event whose timestamp matches the stored one *and* whose status matches the stored one. A repeat that changes nothing is skipped — and so is a repeat that changes `endsAt`, `paddlePlanId` or `cancellationScheduled` within the same second.

The Redis layer is an optimisation that keeps stale events from reaching the database. The row lock is what actually guarantees correctness.

### Calling the Paddle API

Only `user.cancel_subscription` reaches Paddle — every other event comes *from* Paddle. `PaddleClient` has a few behaviours worth knowing:

| Behaviour | What happens |
|-----------|--------------|
| Cancel timing | The request sends `effective_from: next_billing_period`, so Paddle cancels the subscription at the **end** of the current billing period, not immediately. The local `Subscription.status` is set to `CANCELED` straight away, so the two sides disagree until the period ends. |
| 404 and 409 | Both are treated as **success**. A subscription Paddle has never heard of (404) or has already canceled (409) logs a warning, and the local row is canceled anyway. |
| Attempts | Up to 3 HTTP attempts per cancel (1 initial + 2 retries). |
| Retried statuses | 429, 503, 500, 502, 504 and 408. Every other non-2xx fails on the first attempt. |
| `Retry-After` | Honoured when the response carries it, and it **replaces** the exponential backoff rather than adding to it. Capped at 30 seconds. |
| Backoff | Exponential with jitter, capped at 30 seconds. |
| Per-attempt timeout | 10 seconds. A timeout is retried like any other network error. |
| Base URL | `https://api.paddle.com` in production, `https://sandbox-api.paddle.com` otherwise. |

A Paddle failure surfaces as a plain `Error`, which the message layer treats as retryable. One logical cancel can therefore make up to 3 × 6 = 18 HTTP requests before the message is dead-lettered.

## Error Handling

### Retry Topology

```mermaid
graph LR
    Q[Main Queue] -->|retryable error| RetryExchange[Retry Exchange]
    RetryExchange --> RetryQ[Retry Queue<br/>TTL 5s]
    RetryQ -->|TTL expires| Q
    
    Q -->|non-retryable| DLX[DLX Exchange]
    DLX --> DLQ[Dead Letter Queue]
```

| Retry Setting | Value | Description |
|---------------|-------|-------------|
| Max retries | 5 | Messages retried up to 5 times |
| Retry delay | 5000ms (5s) | TTL on retry queue |
| Retry exchange | `{queue}_retry_exchange` | Routes retryable messages |
| Retry queue | `{queue}_retry` | Delayed message storage |

### Error Classification

| Error | Retryable? | Action |
|-------|------------|--------|
| `UserNotFoundError` | No | DLQ (webhook before user exists) |
| `MissingFieldError` | No | DLQ (missing required data) |
| `InvalidTransitionError` | No | DLQ (invalid status change) |
| `UnhandledEventError` | No | DLQ (no handler registered for this event type) |
| `SyntaxError` / malformed JSON | No | DLQ (the message body is not JSON) |
| DB unavailable | Yes (infra) | Requeue (no retry burn) |
| Transient DB error | Yes | Retry via delayed exchange |
| Redis error (idempotency) | N/A | Fail-open, process anyway |

Retryability is decided by the error's `name`, not by the class hierarchy. That is deliberate: it means a `UserNotFoundError` that crossed a process boundary and arrived as plain JSON is still classified correctly.

**The database health check runs first.** Before any of this, the worker asks whether PostgreSQL is reachable. If it is not, the message is requeued regardless of what went wrong — including a poison message that would otherwise be dead-lettered. Those messages only reach the dead letter queue once the database recovers.

### Infra-Requeue

When the database is unavailable (not the event's fault), the worker uses infra-requeue:

```mermaid
graph TB
    A[Handler fails] --> B[Check DB health]
    B --> C{DB healthy?}
    C -->|No| D[Log infra-requeue]
    D --> E[Sleep 5s]
    E --> F[NACK with requeue]
    C -->|Yes| G[Check retry count]
    G --> H{Retries left?}
    H -->|Yes| I[Retry via delayed exchange]
    H -->|No| J[Send to DLQ]
```

**Why infra-requeue?**
- Database being down is not the event's fault
- No retry burn (doesn't count against max retries)
- No DLQ (message is valid, just can't be processed yet)
- Message re-enters the queue after a short delay

**The worker requeues a message three different ways.** Only the first is the infra-requeue path above.

| Path | When | Retry count |
|------|------|-------------|
| Infra-requeue | PostgreSQL is not reachable | Does not burn |
| Publish buffer full | The broker's publish buffer is full, so the retry exchange cannot accept the message | Does not burn |
| Dead letter | The retry budget is exhausted, the error is not retryable, **or** publishing to the retry exchange failed | Burns on the retry path |

A failure to publish to the retry exchange sends the message straight to the dead letter queue on the first attempt, even though the retry budget was not used up. `worker_dead_lettered_total` cannot tell that apart from a genuinely exhausted message.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PADDLE_API_KEY` | (required) | Paddle API key for cancel requests |
| `PADDLE_ENVIRONMENT` | `sandbox` | `sandbox` or `production`. Required in prod. |
| `EVENT_REDIS_URL` | (required) | Redis for Paddle event dedup and event ordering |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` in dev | RabbitMQ connection. Required in prod. |
| `RABBITMQ_PREFETCH` | 10 | Unacked messages per consumer (1-1000). The Payments worker raises the base default of 1. |
| `INFRA_REQUEUE_DELAY_MS` | 5000 | Delay before infra-requeue when the database is down |
| `PORT` | 7777 | Health server port. Docker Compose sets 7003. |

See [Configuration](../getting-started/configuration.md) for the full list of shared settings.

## Metrics

| Metric | What It Tells You |
|--------|-------------------|
| `worker_jobs_processed_total` | Events processed, labelled by event type |
| `worker_job_errors_total` | Failed events by error type |
| `worker_job_duration_seconds` | Processing time per event, labelled with the outcome |
| `worker_dead_lettered_total` | Messages sent to DLQ |
| `worker_duplicate_events_total` | Duplicate events filtered |
| `worker_unhandled_events_total` | Events with no registered handler, and events that arrived without a `userId` |
| `worker_idempotency_redis_errors_total` | Redis dedup failures that fell back to the database |
| `worker_cron_stale_events_filtered_total` | Duplicate events skipped, under `reason="duplicate"` (the `cron_` prefix is in the metric name, but all three workers use it) |
| `worker_retry_total` | Retry attempts |
| `worker_infra_requeued_total` | Infra-requeue count |
| `paddle_cancel_total` | Paddle cancel HTTP attempts by status — one cancel can be counted more than once |
| `paddle_request_duration_seconds` | Paddle API call duration |

## Troubleshooting

**Events not processing?**
- Check RabbitMQ connectivity
- Verify `payment_events` queue exists
- Look at worker logs for connection errors

**Many messages in DLQ?**
- Check `worker_dead_lettered_total` metric
- Review error logs for specific failure reasons
- Common: `UserNotFoundError` (webhook before user row), `InvalidTransitionError` (out-of-order webhooks)

**High duplicate count?**
- Paddle may be retrying webhooks — check Paddle dashboard
- Idempotency store is working correctly (duplicates are safely filtered)

**Stale events being filtered?**
- Check `worker_cron_stale_events_filtered_total{reason="duplicate"}` metric
- Webhooks arriving out of order — usually self-correcting

## Next Steps

- [Message Flows](../concepts/message-flows.md) - Payment flow overview
- [Architecture](../concepts/architecture.md) - System design
- [Health](../operations/health.md) - Monitoring the worker
