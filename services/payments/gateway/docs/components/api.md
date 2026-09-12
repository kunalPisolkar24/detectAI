# API Reference

This document explains how to use the Payment Gateway HTTP API.

## Overview

The gateway exposes a simple HTTP API with four endpoints:

- **Health checks** - Monitor service status
- **Paddle webhooks** - Receive payment events from Paddle
- **Internal events** - Receive events from your web application

## Endpoints

| Method | Path | Purpose | Authentication |
|--------|------|---------|----------------|
| `GET` | `/healthz` | Liveness check | None |
| `GET` | `/readyz` | Readiness check | None |
| `GET` | `/metrics` | Prometheus metrics | None |
| `POST` | `/webhook/paddle` | Paddle webhook | `Paddle-Signature` header |
| `POST` | `/internal/events` | Internal event | `X-Internal-Key` header |

## Health Endpoints

### Liveness Check

**What it does:** Checks if the gateway process is running.

```bash
curl http://localhost:8080/healthz
```

**Response:**

```json
{
  "status": "ok"
}
```

**When to use:**
- Kubernetes liveness probe
- Basic "is it alive?" check
- Load balancer health check

### Readiness Check

**What it does:** Checks if the gateway can serve requests (RabbitMQ connected).

```bash
curl http://localhost:8080/readyz
```

**Response (healthy):**

```json
{
  "status": "ok",
  "service": "gateway"
}
```

**Response (unhealthy):**

```json
{
  "status": "error",
  "rabbitmq": "disconnected"
}
```

**When to use:**
- Kubernetes readiness probe
- Load balancer routing decisions
- Monitoring RabbitMQ connectivity

## Paddle Webhook Endpoint

**What it does:** Receives webhooks from Paddle and queues them for processing.

### Request

```bash
curl -X POST http://localhost:8080/webhook/paddle \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: ts=1710000000;h1=abc123..." \
  -d '{
    "event_id": "evt_123",
    "event_type": "subscription.updated",
    "alert_name": "subscription_updated",
    "data": {...}
  }'
```

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `Paddle-Signature` | Yes | HMAC signature: `ts=...;h1=...` |

### Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string | Yes | Unique event identifier |
| `event_type` | string | Yes | Event type (e.g., `subscription.updated`) |
| `alert_name` | string | No | Legacy Paddle event type |

**Note:** Body must be under **1 MiB**.

### Responses

| Status | Body | When | Retryable |
|--------|------|------|-----------|
| `200` | `{"status": "queued"}` | Event published successfully | - |
| `400` | `{"error": "Request body too large or unreadable"}` | Body > 1 MiB or invalid | No |
| `401` | `{"error": "Invalid signature"}` | HMAC validation failed | No |
| `500` | `{"error": "Internal Server Error"}` | Publish failed (nacked/timeout) | No |
| `503` | `{"error": "Service Unavailable", "retryable": true}` | RabbitMQ down | **Yes** |

**Retry-After header** on 503: `Retry-After: 5` (seconds)

## Internal Events Endpoint

**What it does:** Receives events from your web application.

### Request

```bash
curl -X POST http://localhost:8080/internal/events \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: your_api_key_here" \
  -d '{
    "event_id": "evt_456",
    "event_type": "user.cancel_subscription"
  }'
```

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | Must be `application/json` |
| `X-Internal-Key` | Yes | API key for authentication |

### Body

Same as Paddle webhook endpoint.

### Responses

| Status | Body | When | Retryable |
|--------|------|------|-----------|
| `200` | `{"status": "queued"}` | Event published successfully | - |
| `400` | `{"error": "Request body too large or unreadable"}` | Body > 1 MiB or invalid | No |
| `401` | `{"error": "Unauthorized"}` | Invalid or missing API key | No |
| `500` | `{"error": "Internal Server Error"}` | Publish failed | No |
| `503` | `{"error": "Service Unavailable", "retryable": true}` | RabbitMQ down | **Yes** |

## Error Handling

### Error Response Format

All errors return JSON with an `error` field:

```json
{
  "error": "Human-readable error message"
}
```

Some errors include additional fields:

```json
{
  "error": "Service Unavailable",
  "retryable": true
}
```

### Error Code Mapping

| Status | Error Type | Cause | Action |
|--------|------------|-------|--------|
| `400` | Bad Request | Body too large or invalid JSON | Fix request body |
| `401` | Unauthorized | Invalid signature or API key | Check credentials |
| `500` | Internal Error | Publish failed | Check gateway logs |
| `503` | Service Unavailable | RabbitMQ down | Wait and retry |

**Why these status codes?**
- **400** - Client error, won't succeed on retry
- **401** - Authentication error, won't succeed on retry
- **500** - Server error, may need investigation
- **503** - Temporary issue, will succeed on retry

### Retry Logic

Only `503` errors should be retried:

```python
# Pseudo-code for retry logic
response = send_webhook(payload)
if response.status == 503:
    retry_after = int(response.headers.get("Retry-After", 5))
    sleep(retry_after)
    response = send_webhook(payload)  # Retry once
```

**Why retry only on 503?**
- 503 means RabbitMQ is temporarily unavailable
- Paddle will retry automatically
- 400/401/500 indicate permanent issues

## Rate Limiting

The gateway does not implement rate limiting because:

- Paddle controls its own retry frequency
- Internal events are from trusted sources
- RabbitMQ provides backpressure
- Rate limiting would complicate the stateless design

## Request Size Limits

| Endpoint | Max Size | Why |
|----------|----------|-----|
| `/webhook/paddle` | 1 MiB | Prevents DoS attacks |
| `/internal/events` | 1 MiB | Consistent limits |

**Why 1 MiB?**
- Paddle webhooks are typically small (< 100 KB)
- 1 MiB prevents memory exhaustion
- Still allows large payloads if needed

## Timeouts

| Operation | Timeout | Why |
|-----------|---------|-----|
| HTTP request | 5 seconds | Prevents hanging |
| RabbitMQ publish | 5 seconds | Ensures responsiveness |
| Graceful shutdown | 10 seconds | Allows in-flight requests |

**Why 5 second timeout?**
- Balances responsiveness vs. reliability
- Paddle retries on timeout
- Gateway stays responsive under load

## CORS

The gateway does not implement CORS because:

- Webhooks are server-to-server (no browser)
- Internal events are from your backend
- No need for cross-origin requests

## Authentication

### Paddle Webhooks

Paddle signs webhooks with HMAC SHA256:

```
Paddle-Signature: ts=1710000000;h1=abc123...
```

The gateway validates:
1. Timestamp is within 5 minutes
2. HMAC matches the body

See [Validation](validation.md) for details.

### Internal Events

Internal events use a simple API key:

```
X-Internal-Key: your_api_key_here
```

The gateway validates:
1. Key is present
2. Key matches `INTERNAL_API_KEY`

## Monitoring

The gateway exposes metrics at `/metrics`:

```bash
curl http://localhost:8080/metrics
```

See [Observability](../operations/observability.md) for available metrics.

## Related Documentation

- [Validation](validation.md) - How authentication works
- [Health](../operations/health.md) - Health check details
- [Observability](../operations/observability.md) - Metrics and monitoring
- [Request Flows](../concepts/request-flows.md) - How requests move through the system
