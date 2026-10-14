# Observability

This document explains how to monitor the Chats service and understand its behavior.

## What is Observability?

Observability means being able to understand what's happening inside a system by looking at its outputs. For the Chats service, this includes:

- **Logs** - Written records of what happened
- **Metrics** - Numbers that measure performance
- **Alerts** - Notifications when something goes wrong

## Logs

Logs are written to standard output in JSON format. They're useful for debugging specific issues. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the same logs are also forwarded to the collector over OTLP/HTTP (`/v1/logs`) with trace correlation (`trace_id`/`span_id` on gRPC request logs) — fail-open, so if the collector is down or no endpoint is set, the service keeps running and stdout logs are unaffected.

Traces are off by default — set `OTEL_EXPORTER_OTLP_ENDPOINT` to an `http(s)://` collector URL to turn them on. The service emits server spans per gRPC method (`rpc.method`) plus client spans for Mongo (`db.system=mongodb`), Redis (`db.system=redis`) and cache operations, all carrying `service.name`, `service.version` and `deployment.environment`.

### What Gets Logged

| Component | What It Logs |
|-----------|--------------|
| API | Request handling, errors |
| Worker | Message processing, failures |
| Database | Connection issues, slow queries |
| Cache | Hit/miss information |

### Example Log Entry

```json
{
  "level": "info",
  "msg": "Message saved",
  "chat_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user123",
  "timestamp": "2024-09-10T12:00:00Z"
}
```

### Log Levels

| Level | When to Use |
|-------|-------------|
| `debug` | Detailed information for debugging |
| `info` | Normal operations |
| `warn` | Something unexpected but not critical |
| `error` | Something failed |

## Metrics

Metrics are numbers that help you understand performance. They're exposed at:

- **API**: `http://localhost:9091/metrics`
- **Worker**: `http://localhost:9099/metrics`

### Key Metrics

#### gRPC (api)

| Metric | What It Tells You |
|--------|-------------------|
| `chat_grpc_requests_total{method,status}` | Call rate per RPC and status |
| `chat_grpc_errors_total{method,code}` | Failures per RPC and gRPC code |
| `grpc_request_duration_seconds{method,status}` | Server-side latency histogram |

#### Message Processing

| Metric | What It Tells You |
|--------|-------------------|
| `chat_messages_ingested_total` | How many messages were saved to database |
| `chat_messages_published_total` | How many messages were added to streams |
| `chat_worker_consumed_total{partition}` | How many stream entries the worker consumed per partition |
| `chat_stream_pending{stream}` | Unacked entries per stream (consumer-group backlog) |
| `chat_message_bytes` | Ingested content size distribution (workload shape) |
| `chat_batch_size` | Messages per worker batch (workload shape) |

#### Datastore latency

| Metric | What It Tells You |
|--------|-------------------|
| `chat_mongo_op_duration_seconds{operation}` | Mongo latency per operation (create_chat, get_history, bulk_upsert, …) |
| `chat_redis_op_duration_seconds{operation}` | Redis latency per operation (publish, …) |
| `chat_cache_op_duration_seconds{operation,result}` | Cache latency per operation and hit/miss/error result |
| `chat_worker_batch_duration_seconds{stage}` | Worker batch time per stage (process, bulk_upsert) |

#### Health

| Metric | What It Tells You |
|--------|-------------------|
| `chat_redis_stream_lag` | How many messages are waiting to be processed |
| `chat_stream_errors_total` | How many stream operations failed |
| `chat_database_errors_total` | How many database operations failed |
| `redis_degraded` | Whether the service is in degraded mode (1 = yes, 0 = no) |

#### Reliability

| Metric | What It Tells You |
|--------|-------------------|
| `chat_dlq_messages_total` | How many messages are in the dead letter queue |
| `chat_sync_fallback_total` | How many messages were saved via sync MongoDB fallback (degraded mode) |

#### Cache

| Metric | What It Tells You |
|--------|-------------------|
| `chat_cache_hits_total` | How often cache was used (fast path) |
| `chat_cache_misses_total` | How often cache was missed (slow path) |
| `chat_cache_populate_bg_total` | How many times the cache was populated in the background after a miss |

### Viewing Metrics

```bash
# View API metrics
curl http://localhost:9091/metrics

# View Worker metrics
curl http://localhost:9099/metrics
```

## Dashboards

New Relic (`infra/observability/dashboards/`):

| Dashboard | What It Shows |
|-----------|---------------|
| `chats.json` | API + worker roles, DocDB ops, Redis streams lag |
| `chats-loadtest.json` | k6 loadtest view (`deployment.environment=loadtest`): 6 pages — Overview, Service, Service Logs, Worker, Worker Logs, Infra (Mongo + Redis, exporters). Area charts with smooth interpolation + gradient, no header markdown. |

Run a loadtest with telemetry via `tests/load/README.md` (`WITH_OBSERVABILITY=1`).
The api reports `service.name=chat-service`, the worker `chat-worker`
(role-aware default when `OTEL_SERVICE_NAME` is unset).

## Alerts

Alerts notify you when something needs attention.

### Built-in Alerts

| Alert | Condition | What It Means |
|-------|-----------|---------------|
| **Chats down** | Service not responding for 2 minutes | Service is down |
| **High error rate** | Too many errors for 5 minutes | Something is broken |
| **High latency** | Requests taking too long for 10 minutes | Performance issue |
| **Stream lag** | Too many messages waiting for 5 minutes | Worker is slow |
| **DLQ growing** | New messages in DLQ for 15 minutes | Messages failing |

### Alert Rules

```yaml
# Example Prometheus alert rule
groups:
  - name: chats
    rules:
      - alert: ChatsDown
        expr: up{job=~"chats.*"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Chats service is down"
```

## Monitoring Checklist

### Daily

- [ ] Check service health status
- [ ] Review error logs
- [ ] Monitor stream lag

### Weekly

- [ ] Review performance trends
- [ ] Check DLQ for stuck messages
- [ ] Validate alert thresholds

### Monthly

- [ ] Review capacity and scaling needs
- [ ] Update alert thresholds if needed
- [ ] Review and clean up old logs

## Troubleshooting with Observability

### Slow Response Times

1. Check `grpc_request_duration_seconds` - Are requests taking too long?
2. Check `chat_cache_hits_total` - Is cache working?
3. Check `chat_database_errors_total` - Database issues?

### Messages Not Saving

1. Check `chat_stream_errors_total` - Stream problems?
2. Check `chat_database_errors_total` - Database problems?
3. Check `chat_dlq_messages_total` - Messages in DLQ?

### High Memory Usage

1. Check `chat_redis_stream_lag` - Too many messages waiting?
2. Check `BATCH_SIZE` - Processing too many at once?
3. Check `STREAM_PARTITION_COUNT` - Too many partitions?

### Degraded Mode Active

1. Check `redis_degraded` metric — is it `1`?
2. Check `chat_sync_fallback_total` — how many messages are using the sync path?
3. Verify Redis is running and accessible
4. Look at logs for "Redis unavailable" or "recovery attempt" messages
5. Once Redis recovers, `redis_degraded` will return to `0` automatically

## Related Documentation

- [Health](health.md) - Health check details
- [Configuration](../getting-started/configuration.md) - Monitoring settings
- [Worker](../components/worker.md) - Background processing details
