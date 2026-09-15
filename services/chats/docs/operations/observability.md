# Observability

This document explains how to monitor the Chats service and understand its behavior.

## What is Observability?

Observability means being able to understand what's happening inside a system by looking at its outputs. For the Chats service, this includes:

- **Logs** - Written records of what happened
- **Metrics** - Numbers that measure performance
- **Alerts** - Notifications when something goes wrong

## Logs

Logs are written to standard output in JSON format. They're useful for debugging specific issues.

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

#### Message Processing

| Metric | What It Tells You |
|--------|-------------------|
| `chat_messages_ingested_total` | How many messages were saved to database |
| `chat_messages_published_total` | How many messages were added to streams |

#### Performance

| Metric | What It Tells You |
|--------|-------------------|
| `grpc_request_duration_seconds` | How long API requests take |

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

The service comes with Grafana dashboards for visualization:

| Dashboard | What It Shows |
|-----------|---------------|
| `07-chat-service-overview.json` | API performance and health |
| `08-chat-worker-overview.json` | Worker performance and health |

### Setting Up Dashboards

1. Import the JSON files into Grafana
2. Configure Prometheus as the data source
3. Point to `chat-service:9091` and `chat-worker:9099`

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
