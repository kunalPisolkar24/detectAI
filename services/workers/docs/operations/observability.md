# Observability

This document explains how to monitor the Workers service and understand its behavior.

## What is Observability?

Observability means being able to understand what's happening inside a system by looking at its outputs. For the Workers service, this includes:

- **Logs** — Written records of what happened
- **Metrics** — Numbers that measure performance
- **Traces** — Distributed request tracking (OpenTelemetry)
- **Alerts** — Notifications when something goes wrong

## Logs

Logs are written to standard output in JSON format. They're useful for debugging specific issues.

### PII Redaction

The logger automatically redacts sensitive information. A **string** value keeps its first three characters and loses the rest — so `user123@example.com` becomes `use***` and `hunter2` becomes `hun***`. The domain is lost along with everything else: only the first three characters of the whole value survive. A value that is **not** a string (a number, an object, a boolean) is replaced entirely with `***`.

| Field name | What it holds |
|------------|---------------|
| `email` | The user's email address |
| `password`, `PASSWORD` | Account passwords |
| `apiKey`, `api_key` | API keys |
| `PADDLE_API_KEY` | The Paddle API key |
| `REDIS_PASSWORD`, `EVENT_REDIS_PASSWORD` | Redis passwords |
| `paddleCustomerId`, `customer_id`, `customerId` | The Paddle customer id |
| `paddleSubscriptionId` | The Paddle subscription id |
| `Authorization`, `authorization` | The bearer token on an outbound request |

Two details worth knowing:

- The match is on the **exact field name**, and it applies at every level of nesting. A field called `customer_email` would not be redacted, but the same field inside a nested object still would be.
- The list is a fixed set. A new field has to be added to it before it can be masked.

### Example Log Entry

```json
{
  "level": "info",
  "message": "Connected to RabbitMQ and topology initialized",
  "queue": "payment_events",
  "type": "quorum",
  "timestamp": "2024-09-10T12:00:00.000Z"
}
```

**The field order is fixed:** `level`, `message`, then `traceId` and `spanId` if a trace is active, then your context fields, and `timestamp` last.

**`traceId` and `spanId` only appear when a span is active.** They are read from the OpenTelemetry span in scope, so a log line written outside a traced operation has neither. The RabbitMQ connection message above is written outside a span, which is why it has no trace context.

### Error Records

An error record has two extra fields, and they come before your context:

```json
{
  "level": "error",
  "message": "Error processing payment event",
  "error": "Invalid subscription status transition: TRIALING -> PAUSED",
  "stack": "InvalidTransitionError: Invalid subscription status transition: TRIALING -> PAUSED\n    at ...",
  "event_type": "subscription.updated",
  "timestamp": "2024-09-10T12:00:00.000Z"
}
```

`error` holds the error's **message**, not the error object, and `stack` is present only when the value was a real `Error`.

### Log Levels

There are three levels. There is no `debug` level — if you need more detail than `info` gives you, look at a metric or a trace instead.

| Level | When to Use |
|-------|-------------|
| `info` | Normal operations (connected, processed, swept) |
| `warn` | Unexpected but not critical (retries, stale events) |
| `error` | Something failed (handler errors, connection failures) |

### What Gets Logged

| Component | What It Logs |
|-----------|--------------|
| Worker | Connection status, message processing, errors |
| PaymentService | Event routing, idempotency checks, handler results |
| SubscriptionSweeper | Batch results, cache invalidation, metrics |
| RabbitMQWorker | Connection attempts, topology setup, message handling |
| Logger | PII redaction, trace context injection |

## Metrics

Metrics are exposed at `http://localhost:<PORT>/metrics` (default ports: 7001/7002/7003).

**The service name is a label, not a prefix.** Every metric carries a default `service` label — `worker-payments`, `worker-analytics` or `worker-cron` — so the metric names are the same on all three workers and you tell them apart in the query:

```promql
# All workers
rate(worker_jobs_processed_total[5m])

# One worker
rate(worker_jobs_processed_total{service="worker-payments"}[5m])
```

A query like `worker_payments_worker_jobs_processed_total` returns nothing.

### Core Worker Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `worker_jobs_processed_total` | Counter | Total jobs processed by type |
| `worker_job_errors_total` | Counter | Failed jobs by error type |
| `worker_job_duration_seconds` | Histogram | Processing time per job |
| `worker_active_jobs` | Gauge | Jobs currently being processed |
| `worker_active_instances` | Gauge | Number of active worker instances |
| `worker_message_size_bytes` | Histogram | Size of incoming messages |
| `worker_dead_lettered_total` | Counter | Messages sent to DLQ |
| `worker_unhandled_events_total` | Counter | Events with no registered handler |

### Messaging Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `rabbitmq_connection_status` | Gauge | 1 = connected, 0 = disconnected |
| `rabbitmq_reconnections_total` | Counter | RabbitMQ reconnection attempts |
| `worker_retry_total` | Counter | Retry attempts before DLQ |
| `worker_infra_requeued_total` | Counter | Infra-requeue count (DB down) |

### Redis Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `redis_connection_status` | Gauge | 1 = connected, 0 = disconnected (per client) |
| `cache_operations_total` | Counter | Cache invalidation operations, under `operation="invalidate"` and `cache_type="main"` |
| `worker_duplicate_events_total` | Counter | Duplicate events filtered |
| `worker_idempotency_redis_errors_total` | Counter | Idempotency Redis errors (fallback to DB) |

### Database Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `db_pool_connections` | Gauge | Pool state by pool name and state (total, idle, waiting) |
| `db_pool_primary_connections` | Gauge | The primary pool's state (total, idle, waiting) |
| `db_pool_replica_connections` | Gauge | The replica pool's state. Only registered when the replica URL differs from the primary. |

### Payment-Specific Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `paddle_cancel_total` | Counter | Paddle cancel requests by status |
| `paddle_request_duration_seconds` | Histogram | Paddle API call duration |

### Cron-Specific Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `worker_cron_loop_iterations_total` | Counter | Loop iterations by result |
| `worker_cron_sweep_batch_size` | Histogram | Batch sizes per sweep |
| `worker_cron_expiry_lag_seconds` | Gauge | Max lag between sweep and oldest expired |
| `worker_cron_expired_backlog` | Gauge | Subscriptions pending sweep |
| `worker_cron_subscription_status` | Gauge | Status distribution |
| `worker_cron_stale_events_filtered_total` | Counter | Rows selected for the sweep but skipped, under `reason="phantom_select"`. Also used by payments and analytics for `reason="duplicate"` and `reason="preview"`. |
| `worker_cron_sweep_skipped_total` | Counter | Rows selected for the sweep but not updated, because a fresher webhook or a concurrent change won the race. Not a lock-contention counter. |
| `worker_cron_cache_invalidate_duration_seconds` | Histogram | Cache invalidation duration |
| `worker_cron_cache_invalidate_retries_total` | Counter | Cache invalidation retries |
| `worker_cron_db_transaction_duration_seconds` | Histogram | Sweep transaction duration by result (committed/rolled back) |
| `worker_cron_shutdown_aborts_total` | Counter | Shutdown aborts by reason |
| `worker_cron_jitter_seconds` | Histogram | Sleep duration with jitter |
| `worker_cron_config` | Gauge | Config values for drift detection |

### Domain Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `worker_domain_operations_volume_total` | Counter | Volume of domain operations (usage flushed). Only the Analytics worker emits it. |

## Metric Labels

The metric names are the same on all three workers — the `service` label is what tells them apart. These are the labels each metric carries and the values they can take.

### Shared metrics

| Metric | Labels | Values |
|--------|--------|--------|
| `worker_jobs_processed_total` | `job_type` | The event type for payments and analytics. `user_downgrade` for the cron sweeper, `usage_reset` for the cron resetter. |
| `worker_job_errors_total` | `job_type`, `error_type` | `job_type` as above, plus `cron_loop`. `error_type` is one of `user_not_found`, `missing_<field>`, `invalid_transition`, `unhandled_event_type`, `missing_userId`, `process_failure`, `db_error`, `redis_error`, `critical`. |
| `worker_job_duration_seconds` | `job_type`, `status` | `status` is `success`, `error`, `duplicate`, `dlq`, `ignored` or `unhandled`. The last three are neither success nor failure. |
| `worker_active_jobs` | `job_type` | As `worker_jobs_processed_total`. |
| `worker_message_size_bytes` | `job_type` | The event type, `other` for anything unrecognised, or `invalid_json` for a body that would not parse. |
| `worker_dead_lettered_total` | `job_type` | As `worker_message_size_bytes`. |
| `worker_retry_total` | `job_type` | As `worker_message_size_bytes`. |
| `worker_infra_requeued_total` | `job_type`, `dep` | `dep` is `postgres`. |
| `worker_unhandled_events_total` | `event_type` | The **real** event type when a known type arrived without a `userId`, and `other` when no handler matched. The label means different things in the two cases. |
| `worker_duplicate_events_total` | `event_type` | The event type — note `event_type`, not `job_type` as with the other counters. |
| `worker_idempotency_redis_errors_total` | — | No labels. Payments only. |
| `worker_cron_stale_events_filtered_total` | `reason` | `duplicate` (payments and analytics), `preview` (analytics) or `phantom_select` (cron). |
| `cache_operations_total` | `operation`, `cache_type` | Only `operation="invalidate"` and `cache_type="main"` are ever emitted. |
| `redis_connection_status` | `client_name` | `PaymentsRedis`, `EventRedis`, `AnalyticsMain` or `CronRedis`. |
| `db_pool_connections` | `pool_name`, `state` | `pool_name` is `primary` or `replica`; `state` is `total`, `idle` or `waiting`. |
| `db_pool_primary_connections` | `state` | `total`, `idle` or `waiting`. |
| `db_pool_replica_connections` | `state` | `total`, `idle` or `waiting`. Only registered when the replica URL differs from the primary. |
| `rabbitmq_connection_status`, `rabbitmq_reconnections_total`, `worker_active_instances` | — | No labels. |

### Cron metrics

| Metric | Labels | Values |
|--------|--------|--------|
| `worker_cron_loop_iterations_total` | `result` | `success` (the sweep expired at least one subscription), `empty` (it found nothing) or `error` (the sweeper threw). |
| `worker_cron_sweep_batch_size` | `stage` | `selected` (rows locked) or `updated` (rows changed). The `updated` series is absent entirely on a worker that has never swept anything. |
| `worker_cron_db_transaction_duration_seconds` | `result` | `committed` or `rolled_back`. |
| `worker_cron_cache_invalidate_duration_seconds` | `attempt` | `1` or `2`. |
| `worker_cron_shutdown_aborts_total` | `reason` | `sleep_aborted`, `job_grace_timeout` or `loop_grace_timeout`. |
| `worker_cron_subscription_status` | `status` | `ACTIVE`, `PAST_DUE`, `PAUSED`, `TRIALING`, `CANCELED` or `NULL`. |
| `worker_cron_config` | `param` | `check_interval_ms` or `batch_size`. |
| `worker_cron_sweep_skipped_total` | — | Counter, no labels. |
| `worker_cron_expired_backlog` | — | Gauge, no labels. |
| `worker_cron_expiry_lag_seconds` | — | Gauge, no labels. |
| `worker_cron_jitter_seconds` | — | Histogram, no labels. |

### Payments metrics

| Metric | Labels | Values |
|--------|--------|--------|
| `paddle_cancel_total` | `status` | The HTTP status code as a string, or `error` for a network failure. One cancel can be counted more than once if it retries. |
| `paddle_request_duration_seconds` | `status` | The HTTP status code as a string, or `error`. |

### Viewing Metrics

```bash
# View Payments worker metrics
curl http://localhost:7003/metrics

# View Analytics worker metrics
curl http://localhost:7001/metrics

# View Cron worker metrics
curl http://localhost:7002/metrics

# Filter specific metrics
curl -s http://localhost:7003/metrics | grep worker_job_errors_total
```

## Traces

The Workers service uses OpenTelemetry for distributed tracing.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty) | Collector URL (empty disables) |
| `OTEL_SERVICE_NAME` | worker-{name} | Service name in traces |
| `OTEL_TRACES_SAMPLER` | `parentbased_traceidratio` | Sampling strategy |
| `OTEL_TRACES_SAMPLER_ARG` | `0.1` | Sample 10% of traces |

The first two are part of the validated configuration schema. The last two are read straight from the environment by the OpenTelemetry SDK, so they are not validated — a typo in the sampler name would silently fall back to the SDK default.

### Spans Created

| Span | What It Tracks |
|------|----------------|
| `queue.consume {queue}` | Message consumption from RabbitMQ |
| `sweep_expired` | Cron sweep iteration |
| `usage_reset` | Cron daily usage reset |
| `cache.invalidate` | Cache invalidation batch |
| `db.expireDueSubscriptions` | The sweep transaction, with the batch limit and the sweep time as attributes |

## Logs in New Relic

Console JSON remains the local and `docker logs` path. When
`OTEL_EXPORTER_OTLP_ENDPOINT` is set, the same records are also exported over
OTLP (`/v1/logs`) so they are queryable in New Relic alongside traces. Console
output is unaffected when the endpoint is unset, and an exporter failure never
blocks the worker.

Sensitive keys (`email`, `apiKey`, `password`, `PADDLE_API_KEY`, `Authorization`,
the Paddle customer/subscription ids) are masked before export, and structured
context values are dropped rather than serialised, since OTLP attributes are
primitives only.

## Dashboards

Dashboards are published as code from [`infra/observability`](../../../../infra/observability) (Terraform). All
three workers share one board, `detectai-workers (<environment>)`, rather than a
board each, following the `detectai-chats` precedent (multiple `service.name`s,
one board, one page each) and because one alert policy covers all three.

| Page | What it answers |
|---|---|
| `Overview` | Is any worker unhealthy? Throughput, errors, broker/cache connectivity, DLQ, cron expiry lag, eventloop lag |
| `Analytics` / `Payments` | Per-worker RED, retries, dead letters, dedup, Paddle latency |
| `Cron` | Sweep cadence, batch size, expiry lag, expired backlog |
| `<Worker> Logs` | Error stream, volume by level, errors by message, slow jobs |
| `Infra` | Are the datastores healthy? Postgres pool + exporter, Redis users/events, RabbitMQ broker |

The `Infra` page is gauge-first and store-ordered: row 1 is four gauges (pool
waiting, pool connections open against `POOL_MAX=5`, Redis disconnected, RabbitMQ
disconnected — 1 means a client is down), rows 2-3 Postgres, rows 4-5 Redis,
rows 6-7 RabbitMQ, rows 8-9 tables (dependency state snapshot, queue inventory).
Worker-side widgets read the worker `/metrics` (`service LIKE 'worker-%'`);
broker-side queue widgets need the RabbitMQ exporter pointed at the management
API, and the Postgres and Redis exporter widgets need the exporter sidecars
running. A widget with no data source stays empty by design rather than showing
zeros.

Counts and rates come from the Prometheus metrics above; percentiles come from
spans. Sampling at `traceidratio 0.1` distorts span *counts*, not percentiles, so
red and green widgets never mix the two.

To see a load run on the `detectai-workers (loadtest)` board:

```bash
export NEW_RELIC_LICENSE_KEY="eu01..."
make load-test WORKER=analytics WITH_OBSERVABILITY=1 VUS=10 DURATION=2m RPS=50
```

See [`src/tests/load/README.md`](../../src/tests/load/README.md) for details.

## Alerts

Alerts notify you when something needs attention.

### Built-in Alerts

Managed in [`infra/observability/alerts.tf`](../../../../infra/observability/alerts.tf) under the
`detectai-workers-<environment>` policy. Criticals are enabled in prod only, so
Floci traffic never mails.

| Alert | Condition | What It Means |
|-------|-----------|---------------|
| **Worker error share high** | span error share > 2% for 10 min, any `worker-*` | Too many failed jobs |
| **Cron expiry lag high** | `worker_cron_expiry_lag_seconds` > 1800 for 15 min | Sweeper is not keeping up |
| **Workers dead-lettering messages** | `rate(worker_dead_lettered_total)` > 0 for 5 min | Messages permanently failing |
| **Workers disconnected from RabbitMQ** | `min(rabbitmq_connection_status)` < 1 for 2 min | Consumers cannot progress |

Expiry lag is gauge-driven rather than a tick count: it fires on a stalled loop
even when the failure is in log delivery rather than in sweeping.

## Monitoring Checklist

### Daily

- [ ] Check worker health status
- [ ] Review error logs
- [ ] Monitor DLQ depth
- [ ] Check RabbitMQ connection status

### Weekly

- [ ] Review performance trends
- [ ] Check cron expiry lag and backlog
- [ ] Validate alert thresholds
- [ ] Review cache invalidation performance

### Monthly

- [ ] Review capacity and scaling needs
- [ ] Update alert thresholds if needed
- [ ] Review and clean up old logs
- [ ] Check database pool utilization

## Troubleshooting with Observability

### Messages Not Processing

1. Check `rabbitmq_connection_status` — is the worker connected?
2. Check `worker_job_errors_total` — what errors are occurring?
3. Check `worker_dead_lettered_total` — messages going to DLQ?
4. Look at logs for specific error messages

### High Latency

1. Check `worker_job_duration_seconds` — are jobs taking too long?
2. Check `db_pool_connections{state="waiting"}` — database bottleneck?
3. Check `worker_cron_cache_invalidate_duration_seconds` — cache issues?

### DLQ Growing

1. Check `worker_dead_lettered_total` by `job_type` — which events are failing? Anything unrecognised is lumped in as `job_type="other"`, so a producer sending an unknown event type shows up there rather than under its own name.
2. Look at logs for the specific error type
3. Common causes: `UserNotFoundError`, `InvalidTransitionError`, `UnhandledEventError`, DB errors

### Cron Not Sweeping

1. Check `worker_cron_loop_iterations_total{result="error"}` — loop errors?
2. Check `worker_cron_expired_backlog` — how many expired subscriptions are still pending?
3. Check `worker_cron_sweep_batch_size{stage="selected"}` against the batch size — a batch that comes back short while the backlog is high means another instance holds those rows
4. Look at logs for critical errors in the cron loop

## Related Documentation

- [Health](health.md) - Health check details
- [Configuration](../getting-started/configuration.md) - Monitoring settings
- [Payments Worker](../components/payments-worker.md) - Payment-specific metrics
- [Analytics Worker](../components/analytics-worker.md) - Analytics-specific metrics
- [Cron Worker](../components/cron-worker.md) - Cron-specific metrics
