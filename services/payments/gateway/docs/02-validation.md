# Validation

## Paddle webhook

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway
    participant Val as Validator
    participant RMQ as RabbitMQ
    Paddle->>GW: POST webhook with Paddle-Signature: ts=...;h1=...
    GW->>Val: Extract ts and h1
    Val->>Val: Check ts within 5min
    Val->>Val: HMAC SHA256 ts:body with secret
    alt valid
        GW->>RMQ: Publish persistent
        RMQ-->>GW: Acked
        GW-->>Paddle: 200 queued
    else invalid
        GW-->>Paddle: 401 Invalid
    end
```

Code at `internal/infrastructure/paddle/signature.go`.

* Header `Paddle-Signature: ts=1234567890;h1=abc...`
* `ts` must be within `5min` of server time (prevents replay).
* `h1 = HMAC_SHA256(secret, "ts:rawBody")` hex-encoded, constant-time compare.
* Raw body size `<=1 MiB`, `5s` context timeout, `persistent` delivery.

## Internal events

```mermaid
sequenceDiagram
    participant Web as WebApp
    participant GW as Gateway
    participant Val as Validator
    Web->>GW: POST /internal/events X-Internal-Key: s3cr3t
    GW->>Val: ValidateInternalKey
    alt valid
        GW-->>Web: 200 queued
    else invalid
        GW-->>Web: 401 Invalid
    end
```

* `X-Internal-Key` must equal `INTERNAL_API_KEY` (16+ chars, constant-time).
* Same `1 MiB` limit and publisher confirms.

## Failure branch

| Input | Code | Metric |
|---|---|---|
| Missing/invalid signature | `401 Invalid` | `invalid_signatures` + `grpc_auth_failures` |
| `ts` drift >5min | `401` | `invalid_signatures` |
| Oversize `>1 MiB` | `400` | `http_requests_total{code=400}` |
| RabbitMQ down | `503` via `readyz` | `rabbitmq_connection_status 0` |

`400` vs `401` vs `500` mapped in `transport/http/handler.go`.
