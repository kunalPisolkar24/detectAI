# Observability

This document explains how to monitor the Payment Gateway and understand its behavior.

## Overview

The gateway provides three types of observability:

- **Metrics** - Quantitative data about the system
- **Logs** - Qualitative information about events
- **Traces** - Distributed tracking across services

Think of metrics as the **dashboard**, logs as the **black box recorder**, and traces as the **GPS tracker**.

## Metrics

The gateway exposes Prometheus metrics at `/metrics`:

```bash
curl http://localhost:8080/metrics
```

### HTTP Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method, route, status_code` | Total HTTP requests |
| `http_request_errors_total` | Counter | `method, route, status_code` | Total HTTP errors |
| `http_request_duration_seconds` | Histogram | `method, route, status_code` | Request duration |

**What these tell you:**
- How many requests are being made
- What the error rate is
- How long requests are taking

### Domain Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `payment_events_published_total` | Counter | `event_type, status` | Events published to RabbitMQ |
| `payment_webhook_signatures_invalid_total` | Counter | - | Invalid Paddle signatures |
| `payment_webhooks_received_total` | Counter | `event_type` | Webhooks received (before validation) |
| `payment_webhooks_unknown_event_type_total` | Counter | - | Webhooks with unknown event type |
| `payment_internal_events_unauthorized_total` | Counter | - | Unauthorized internal events |
| `payment_webhook_body_errors_total` | Counter | `reason` | Body read errors |
| `payment_signature_validation_duration_seconds` | Histogram | - | Signature validation time |

**What these tell you:**
- How many events are flowing through
- How many invalid signatures are being rejected
- How long validation takes

### Infrastructure Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `rabbitmq_connection_status` | Gauge | - | `1` = connected, `0` = disconnected |
| `rabbitmq_publish_duration_seconds` | Histogram | - | Time to publish and get confirmation |
| `rabbitmq_reconnections_total` | Counter | - | Number of reconnections |

**What these tell you:**
- If RabbitMQ is connected
- How long publishing takes
- How often reconnections happen

### Build Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `gateway_build_info` | Gauge | `version, commit` | Build information |

## Logs

The gateway outputs structured JSON logs to stdout:

```json
{
  "level": "info",
  "msg": "Gateway config loaded",
  "port": "8080",
  "queue_type": "quorum",
  "rabbit_url": "amqp://***@rabbitmq:5672/",
  "env_type": "dev",
  "time": "2024-03-10T12:00:00Z"
}
```

When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the same logs are also forwarded to the collector over OTLP/HTTP (`/v1/logs`) — fail-open, so if the collector is down or no endpoint is set, the service keeps running and stdout logs are unaffected. Every span and log carries `service.name`, `service.version`, and `deployment.environment` (`OTEL_RESOURCE_ATTRIBUTES` wins, then `DEPLOYMENT_ENV`, then `ENV_TYPE`).

### Log Levels

| Level | When to Use |
|-------|-------------|
| `debug` | Detailed debugging information |
| `info` | Normal operation events |
| `warn` | Unexpected but recoverable events |
| `error` | Failures that need attention |

### Setting Log Level

```bash
# Development
LOG_LEVEL=debug

# Production
LOG_LEVEL=info
```

### Key Log Messages

| Message | Level | What It Means |
|---------|-------|---------------|
| `Gateway config loaded` | info | Configuration loaded successfully |
| `Gateway starting` | info | Server is starting |
| `RabbitMQ connected and initialized` | info | Connection established |
| `Event queued successfully` | info | Event published to RabbitMQ |
| `Failed to connect to RabbitMQ` | error | Connection failed, will retry |
| `Connection closed, reconnecting` | error | Connection lost, attempting reconnect |
| `Failed to process webhook` | error | Webhook processing failed |

## Tracing

The gateway supports OpenTelemetry tracing for distributed tracking.

### Configuration

```bash
# Enable tracing + log export (empty endpoint disables both, fail-open)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=payment-gateway
OTEL_SERVICE_VERSION=1.0.0
# Optional: extra resource attributes merged into every span/log
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=loadtest
```

### Spans

The gateway creates spans for key operations:

| Span Name | What It Tracks |
|-----------|----------------|
| `PaymentService.ProcessWebhook` | Webhook processing |
| `PaymentService.ProcessInternalEvent` | Internal event processing |

### Span Attributes

| Attribute | Description |
|-----------|-------------|
| `event_type` | Type of event being processed |
| `event_id` | Unique event identifier |
| `source` | `paddle` or `internal` |
| `publish_status` | `success` or `error` |

### When to Use Tracing

- **Debugging latency** - Find slow operations
- **Distributed debugging** - Track requests across services
- **Performance analysis** - Identify bottlenecks

## Dashboards

### Key Dashboard Queries

```promql
# Request rate
rate(http_requests_total[5m])

# Error rate
rate(http_requests_total{code=~"5.."}[5m])

# 503 rate (fast-fail)
rate(http_requests_total{code="503"}[5m])

# RabbitMQ connection status
rabbitmq_connection_status

# Reconnection rate
rate(rabbitmq_reconnections_total[5m])

# Event publication rate
rate(payment_events_published_total[5m])

# Invalid signature rate
rate(payment_webhook_signatures_invalid_total[5m])
```

### Recommended Panels

1. **Request Rate** - Total requests per second
2. **Error Rate** - 4xx and 5xx responses per second
3. **503 Rate** - Fast-fail responses (indicates RabbitMQ issues)
4. **RabbitMQ Status** - Connection status (1 = connected, 0 = disconnected)
5. **Publish Latency** - Time to publish messages
6. **Invalid Signatures** - Security-related rejections

## Load-Test Observability (Opt-in)

Normal load runs are fully offline — no collector, no network calls. When you want traces, metrics, and logs in New Relic, add `WITH_OBSERVABILITY=1`:

```bash
export NEW_RELIC_LICENSE_KEY="..."   # ingest key, never commit it
make load-test SCENARIO=spike WITH_OBSERVABILITY=1 TARGET_VUS=20
```

What that flag does: it starts `otel-collector-loadtest` (shared atom at `infra/docker/otel/`, same one document-parser uses) alongside the gateway on the load network. The collector scrapes `payment-gateway:8080/metrics` every 15s, gathers host CPU and memory plus per-container CPU, memory, network, and throttling stats via the Docker socket, and exports everything to New Relic EU over `https://otlp.eu01.nr-data.net:443`. Keep port `443` — port `4318` is blocked on this egress path.

Two details that keep dashboards clean:

- Telemetry is labeled `deployment.environment=loadtest` while `ENV_TYPE` stays `dev`, so app behavior is unchanged but k6 traffic never pollutes prod boards. Look for the `detectai-payment-gateway (loadtest)` dashboard; prod uses `detectai-payment-gateway (prod|floci)` with identical panels.
- The collector drops noisy but healthy spans (`/healthz`, `/readyz`, `/metrics` with OK status) to control cost. Failed spans — for example `503` from `/readyz` when RabbitMQ is down — are kept.

If `NEW_RELIC_LICENSE_KEY` is empty, the collector retries and drops while the apps keep running — fail-open by design.

## Alerts

### Critical Alerts

| Alert | Expression | For | Why |
|-------|------------|-----|-----|
| Gateway down | `up{job="gateway"}==0` | 1 minute | Service unavailable |
| RabbitMQ down | `rabbitmq_connection_status==0` | 1 minute | Can't process events |

### Warning Alerts

| Alert | Expression | For | Why |
|-------|------------|-----|-----|
| High invalid signatures | `rate(invalid_signatures[5m]) >0.1` | 5 minutes | Possible attack |
| High publish latency | `histogram_quantile(0.95, http_request_duration) >0.5` | 5 minutes | Performance issue |
| DLQ depth | `rabbitmq_queue_messages{queue="dlq"} >10` | 5 minutes | Messages failing |
| Retry depth | `rabbitmq_queue_messages{queue="retry"} >50` | 5 minutes | High retry rate |

### Alert Configuration

```yaml
groups:
  - name: payment-gateway
    rules:
      - alert: GatewayDown
        expr: up{job="gateway"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Payment gateway is down"
          
      - alert: RabbitMQDown
        expr: rabbitmq_connection_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "RabbitMQ connection is down"
          
      - alert: HighInvalidSignatures
        expr: rate(invalid_signatures[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High rate of invalid signatures"
```

## Monitoring Checklist

### Daily

- [ ] Check 503 rate (should be low or zero)
- [ ] Check RabbitMQ connection status (should be 1)
- [ ] Check error rate (should be low)
- [ ] Review any alerts that fired

### Weekly

- [ ] Review publish latency trends
- [ ] Check DLQ depth (should be low)
- [ ] Review invalid signature rate
- [ ] Check reconnection rate

### Monthly

- [ ] Review overall traffic patterns
- [ ] Check for capacity planning needs
- [ ] Review alert thresholds
- [ ] Update dashboards if needed

## Troubleshooting with Observability

### High 503 Rate

**Symptoms:**
- Many 503 responses
- `rabbitmq_connection_status == 0`

**What to check:**
1. Is RabbitMQ running?
2. Is the connection stable?
3. Are there network issues?

**Metrics to investigate:**
- `rabbitmq_connection_status`
- `rabbitmq_reconnections_total`
- `http_requests_total{code="503"}`

### High Latency

**Symptoms:**
- Slow responses
- High `http_request_duration_seconds`

**What to check:**
1. Is RabbitMQ slow?
2. Is the gateway overloaded?
3. Are there resource issues?

**Metrics to investigate:**
- `http_request_duration_seconds`
- `rabbitmq_publish_duration_seconds`
- System metrics (CPU, memory)

### High Error Rate

**Symptoms:**
- Many 4xx or 5xx responses
- High `http_request_errors_total`

**What to check:**
1. Are clients sending bad requests?
2. Is authentication failing?
3. Is there a bug?

**Metrics to investigate:**
- `http_request_errors_total{code="4.."}`
- `http_request_errors_total{code="5.."}`
- `payment_webhook_signatures_invalid_total`

### Messages Stuck in DLQ

**Symptoms:**
- High DLQ depth
- Messages not being processed

**What to check:**
1. Is worker-payments running?
2. Is worker-payments failing?
3. Are messages malformed?

**Metrics to investigate:**
- `rabbitmq_queue_messages{queue="dlq"}`
- `payment_events_published_total{status="error"}`

## Related Documentation

- [Health](health.md) - Health check details
- [Message Delivery](../concepts/message-delivery.md) - RabbitMQ metrics
- [API Reference](../components/api.md) - Endpoint metrics
- [Configuration](../getting-started/configuration.md) - Tracing settings
