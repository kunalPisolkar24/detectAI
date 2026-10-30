# Request Flows

This document explains how requests move through the Payment Gateway system.

## Overview

The gateway handles two types of requests:

1. **Paddle Webhooks** - External events from Paddle payment processor
2. **Internal Events** - Events from your web application

Both follow similar paths but have different validation mechanisms.

## Paddle Webhook Flow

This is the primary flow for receiving payment events from Paddle.

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway
    participant Val as Validator
    participant RMQ as RabbitMQ
    
    Paddle->>GW: POST /webhook/paddle
    GW->>GW: Read body (1 MiB limit)
    GW->>Val: Validate Paddle-Signature
    alt Invalid signature
        Val-->>GW: false
        GW-->>Paddle: 401 Invalid signature
    else Valid signature
        Val-->>GW: true
        GW->>RMQ: Publish with confirms
        alt RabbitMQ down
            RMQ-->>GW: ErrNotConnected
            GW-->>Paddle: 503 retryable + Retry-After: 5
        else Publish nacked
            RMQ-->>GW: nacked
            GW-->>Paddle: 500 Internal Server Error
        else Publish acked
            RMQ-->>GW: acked
            GW-->>Paddle: 200 queued
        end
    end
```

**What happens:**
1. Paddle sends a POST request with JSON body and `Paddle-Signature` header
2. Gateway reads the body (max 1 MiB)
3. Gateway validates the HMAC signature
4. If invalid, returns 401 (Paddle won't retry)
5. If valid, publishes to RabbitMQ with publisher confirms
6. If RabbitMQ is down, returns 503 (Paddle will retry)
7. If publish fails, returns 500
8. If publish succeeds, returns 200

**Why this flow?**
- **Fast validation** - Rejects bad requests early
- **Secure** - HMAC prevents spoofed webhooks
- **Reliable** - Publisher confirms ensure delivery
- **Observable** - Metrics track every outcome

## Internal Event Flow

This flow handles events from your web application (e.g., user cancellation).

```mermaid
sequenceDiagram
    participant Web as WebApp
    participant GW as Gateway
    participant RMQ as RabbitMQ
    
    Web->>GW: POST /internal/events
    GW->>GW: Check X-Internal-Key
    alt Invalid key
        GW-->>Web: 401 Unauthorized
    else Valid key
        GW->>GW: Read body (1 MiB limit)
        GW->>RMQ: Publish with confirms
        alt RabbitMQ down
            RMQ-->>GW: ErrNotConnected
            GW-->>Web: 503 retryable + Retry-After: 5
        else Publish acked
            RMQ-->>GW: acked
            GW-->>Web: 200 queued
        end
    end
```

**What happens:**
1. WebApp sends a POST request with JSON body and `X-Internal-Key` header
2. Gateway validates the API key
3. If invalid, returns 401
4. If valid, reads the body and publishes to RabbitMQ
5. Returns 200, 503, or 500 based on publish result

**Why a separate flow?**
- Different authentication (API key vs HMAC)
- No signature validation needed (trusted internal source)
- Same reliability guarantees (publisher confirms)

## Error Handling Flow

The gateway maps errors to specific HTTP status codes:

```mermaid
graph TB
    Start[Request] --> Validate{Validate}
    Validate -->|Invalid| Error401[401 Unauthorized]
    Validate -->|Valid| Publish{Publish to RMQ}
    Publish -->|RMQ down| Error503[503 Retryable]
    Publish -->|Nacked| Error500[500 Internal Error]
    Publish -->|Acked| Success[200 Queued]
    Start --> Body{Read Body}
    Body -->|Too large| Error400[400 Bad Request]
    Body -->|OK| Validate
```

### Error Code Mapping

| Error | Status Code | Retryable | Header | Why |
|-------|-------------|-----------|--------|-----|
| Invalid signature | 401 | No | - | Bad auth, won't succeed on retry |
| Bad API key | 401 | No | - | Unauthorized, won't succeed on retry |
| Body too large or unreadable (> 1 MiB) | 400 | No | - | Client error, reduce payload |
| RabbitMQ down | 503 | Yes | `Retry-After: 5` | Temporary, Paddle will retry |
| Publish nacked | 500 | No | - | Broker rejected, may need investigation |
| Context timeout | 503 | Yes | `Retry-After: 5` | Temporary, Paddle will retry |

**What about malformed JSON or unknown types?**
- They still return `200 queued` as `unknown` — only oversize/unreadable returns `400`.

**Why these status codes?**
- **401** - Client error (bad auth), no point retrying
- **400** - Client error (bad request), no point retrying
- **503** - Temporary issue, caller should retry
- **500** - Server error, may need investigation

## Fast-Fail Behavior

When RabbitMQ is down, the gateway **fast-fails** instead of buffering:

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway
    participant RMQ as RabbitMQ
    
    Note over RMQ: RabbitMQ is DOWN
    Paddle->>GW: POST /webhook/paddle
    GW->>RMQ: Publish
    RMQ-->>GW: ErrNotConnected
    GW-->>Paddle: 503 retryable + Retry-After: 5
    Note over Paddle: Paddle retries later
```

**Why fast-fail?**
- **No data loss** - If gateway buffered and crashed, buffered messages are lost
- **Paddle retries** - Paddle automatically retries on 503
- **Simpler** - No buffering logic to maintain
- **Faster recovery** - Gateway stays responsive even when RMQ is down

**Why not buffer?**
- Buffer would be in-memory (lost on crash)
- Buffer adds complexity
- Paddle already handles retries
- Buffer could grow unbounded under load

## Event Processing

Both flows extract event metadata with `domain.ParseEvent`, but always forward the raw body:

```mermaid
graph TB
    JSON[Raw Body] --> Parse[ParseEvent]
    Parse --> EventType{event_type?}
    Parse --> EventID{event_id?}
    EventType -->|Present| Use[Use event_type]
    EventType -->|Missing| Legacy[Check alert_name]
    Legacy -->|Present| Use
    Legacy -->|Missing| Unknown[unknown]
    Parse -->|Malformed JSON| Unknown
    Use --> Metrics[Record Metrics]
    Unknown --> Metrics
    EventID --> Tracing[Add to Span]
    Use --> Publish[Publish raw body]
    Unknown --> Publish
```

**What happens:**
1. Gateway parses the JSON body (tolerant, never fails the request)
2. Extracts `event_type` field (primary)
3. Falls back to `alert_name` field (legacy Paddle)
4. If neither exists or JSON is malformed, uses `"unknown"`
5. Extracts `event_id` for tracing
6. Records metrics (`payment_webhooks_received_total`, `payment_webhooks_unknown_event_type_total`) and adds to OpenTelemetry span
7. Publishes the original raw bytes to RabbitMQ — even `unknown` events return `200 queued`

**Why extract event type?**
- Metrics need to know what type of event was processed
- Tracing needs to correlate events
- Debugging requires knowing what events are flowing

**Why tolerant?**
- New Paddle types and malformed payloads still reach `worker-payments` instead of being dropped
- Only over-limit (> 1 MiB) or unreadable bodies return `400`

## Related Documentation

- [Message Delivery](message-delivery.md) - What happens after publishing
- [Validation](../components/validation.md) - How validation works
- [API Reference](../components/api.md) - HTTP endpoint details
- [Observability](../operations/observability.md) - How to monitor flows
