# Payment Gateway

Stateless Go service that validates Paddle webhooks and forwards events to RabbitMQ for `worker-payments`. No DB — raw byte passthrough with publisher confirms and DLQ.

## Overview

```
Paddle webhook ──► Gateway ──► RabbitMQ payment_events ──► worker-payments
Web app (cancel) ─┘
```

- Handles `POST /webhook/paddle` (HMAC) and `POST /internal/events` (`X-Internal-Key`).
- Forwards raw JSON with `1 MiB` limit, `5s` timeout, persistent `application/json`.

## Architecture

```mermaid
graph LR
    Paddle --> GW[Gateway]
    WebApp --> GW
    GW --> RMQ[(RabbitMQ)]
    RMQ --> Worker[worker-payments]
    Worker --> DB[(Postgres)]
    RMQ --> DLQ[(DLQ)]
    RMQ --> RQ[(Retry)]
    RQ --> RMQ
```

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway
    participant Val as Validator
    participant RMQ as RabbitMQ
    Paddle->>GW: POST webhook
    GW->>Val: Validate signature
    alt invalid
        GW-->>Paddle: 401 Invalid
    else valid
        GW->>RMQ: Publish
        RMQ-->>GW: Acked
        GW-->>Paddle: 200 queued
    end
```

```mermaid
graph TB
    MainQ[ payment_events ] --> Rex[ retry_exchange ]
    Rex --> RQ[ retry queue TTL 5000 ]
    RQ --> MainQ
    MainQ --> DLX[ dlx ]
    DLX --> DLQ[ dlq ]
```

- `ProcessWebhook` vs `ProcessInternalEvent` with `event_id` tracing.
- Quorum vs classic via `RABBITMQ_QUEUE_TYPE` (quorum in prod).

## Webhook Validation

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway
    participant Val as Validator
    participant RMQ as RabbitMQ
    Paddle->>GW: POST webhook with signature
    GW->>Val: Extract ts and h1
    Val->>Val: Check ts within 5min
    Val->>Val: HMAC SHA256 ts body with secret
    alt valid
        GW->>RMQ: Publish persistent
        RMQ-->>GW: Acked
        GW-->>Paddle: 200 queued
    else invalid
        GW-->>Paddle: 401 Invalid
    end
```

## Configuration

```ini
PADDLE_WEBHOOK_SECRET=whsec_...  # required
INTERNAL_API_KEY=s3cr3t          # required
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/  # optional
RABBITMQ_QUEUE_TYPE=classic      # optional, quorum in prod
PORT=8080                        # optional
OTEL_EXPORTER_OTLP_ENDPOINT=     # optional, disables tracing
OTEL_SERVICE_NAME=payment-gateway # optional
```

## API

```text
GET  /healthz          -> 200 {"status":"ok"}
GET  /readyz           -> 200 or 503 if RabbitMQ down
GET  /metrics          -> Prometheus
POST /webhook/paddle   (Paddle-Signature) -> 200 queued | 400 401 500
POST /internal/events  (X-Internal-Key)   -> 200 queued | 401 400 500
```

## Testing

```bash
make test              # go test -v ./...
make test-coverage     # go test -v -coverprofile=coverage.out ./... + go tool cover -func
make test-integration  # go test -v -tags=integration ./test/integration/... (testcontainers)
make load-test SCENARIO=spike TARGET_VUS=100  # k6 spike/stress/soak/internal
```
