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

The logger automatically redacts sensitive information:

| Field Pattern | Redaction |
|---------------|-----------|
| `email` | `us***@example.com` |
| `password` | `***` |
| `apiKey` | `***` |
| `PADDLE_API_KEY` | `***` |
| `REDIS_PASSWORD` | `***` |

### Example Log Entry

```json
{
  "level": "info",
  "message": "Connected to RabbitMQ and topology initialized",
  "queue": "payment_events",
  "type": "quorum",
  "traceId": "abc123",
  "spanId": "def456",
  "timestamp": "2024-09-10T12:00:00.000Z"
}
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| `debug` | Detailed information for debugging |
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

All metrics are prefixed with the service name (e.g., `worker-payments`, `worker-analytics`, `worker-cron`).

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
| `cache_operations_total` | Counter | Cache hits and misses |
| `worker_duplicate_events_total` | Counter | Duplicate events filtered |
| `worker_idempotency_redis_errors_total` | Counter | Idempotency Redis errors (fallback to DB) |

### Database Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `db_pool_connections` | Gauge | Pool state (total, idle, waiting) |

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
| `worker_cron_stale_events_filtered_total` | Counter | Phantom/stale events filtered |
| `worker_cron_cache_invalidate_duration_seconds` | Histogram | Cache invalidation duration |
| `worker_cron_db_lock_skipped_total` | Counter | SKIP LOCKED rows |
| `worker_cron_shutdown_aborts_total` | Counter | Shutdown aborts by reason |
| `worker_cron_jitter_seconds` | Histogram | Sleep duration with jitter |
| `worker_cron_config` | Gauge | Config values for drift detection |

### Domain Metrics

| Metric | Type | What It Tells You |
|--------|------|-------------------|
| `worker_domain_operations_volume_total` | Counter | Volume of domain operations (usage flushed) |

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

### Spans Created

| Span | What It Tracks |
|------|----------------|
| `queue.consume {queue}` | Message consumption from RabbitMQ |
| `sweep_expired` | Cron sweep iteration |
| `cache.invalidate` | Cache invalidation batch |

## Dashboards

The service works with Grafana dashboards for visualization:

### Setting Up Dashboards

1. Import JSON files into Grafana
2. Configure Prometheus as the data source
3. Point to each worker's metrics port

### Key Panels to Create

| Panel | Metric | Visualization |
|-------|--------|---------------|
| Job success rate | `worker_jobs_processed_total` | Time series |
| Error rate | `worker_job_errors_total` | Time series |
| Processing duration | `worker_job_duration_seconds` | Heatmap |
| DLQ depth | `worker_dead_lettered_total` | Stat |
| RabbitMQ status | `rabbitmq_connection_status` | Stat |
| DB pool pressure | `db_pool_connections{state="waiting"}` | Time series |
| Cron expiry lag | `worker_cron_expiry_lag_seconds` | Time series |

## Alerts

Alerts notify you when something needs attention.

### Built-in Alerts

| Alert | Condition | What It Means |
|-------|-----------|---------------|
| **Worker down** | `rabbitmq_connection_status == 0` for 2 min | Worker disconnected from broker |
| **High error rate** | `rate(worker_job_errors_total[5m]) > 0.1` | Too many errors |
| **DLQ growing** | `rate(worker_dead_lettered_total[5m]) > 0` | Messages failing |
| **DB pool pressure** | `db_pool_connections{state="waiting"} > 5` | Database bottleneck |
| **Cron loop stale** | `worker_cron_loop_iterations_total{result="success"}` unchanged for 30 min | Cron not sweeping |
| **High expiry lag** | `worker_cron_expiry_lag_seconds > 3600` | Subscriptions expired > 1 hour ago |

### Alert Rules

```yaml
groups:
  - name: workers
    rules:
      - alert: WorkerDown
        expr: rabbitmq_connection_status == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Worker {{ $labels.service }} disconnected from RabbitMQ"

      - alert: HighErrorRate
        expr: rate(worker_job_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High error rate in {{ $labels.service }}"

      - alert: CronLoopStale
        expr: increase(worker_cron_loop_iterations_total{result="success"}[30m]) == 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Cron worker has not swept in 30 minutes"
```

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

1. Check `worker_dead_lettered_total` by `job_type` — which events are failing?
2. Look at logs for the specific error type
3. Common causes: `UserNotFoundError`, `InvalidTransitionError`, DB errors

### Cron Not Sweeping

1. Check `worker_cron_loop_iterations_total{result="error"}` — loop errors?
2. Check `worker_cron_expiry_lag_seconds` — is lag increasing?
3. Check `worker_cron_db_lock_skipped_total` — lock contention?
4. Look at logs for critical errors in the cron loop

## Related Documentation

- [Health](health.md) - Health check details
- [Configuration](../getting-started/configuration.md) - Monitoring settings
- [Payments Worker](../components/payments-worker.md) - Payment-specific metrics
- [Analytics Worker](../components/analytics-worker.md) - Analytics-specific metrics
- [Cron Worker](../components/cron-worker.md) - Cron-specific metrics
