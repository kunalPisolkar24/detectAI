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

## Features

- HMAC `ts:body` SHA256 ±5min, constant-time compare
- Body limit `1 MiB` + `5s` context
- Publisher confirms with `RecordRabbitMQPublishDuration`
- Topology `dlx`/`dlq` + `retry` `TTL 5000` + `406` hint `payment_events_v2`
- Reconnect `5s` + `readyz` `503`
- OTel tracing + Prometheus metrics (15 families)

## Quick Start

```bash
go 1.25

export PADDLE_WEBHOOK_SECRET=whsec_...
export INTERNAL_API_KEY=s3cr3t
export RABBITMQ_URL=amqp://guest:guest@localhost:5672/
export PORT=8080

go run ./cmd/gateway/main.go
# or
make run

curl http://localhost:8080/healthz  # {"status":"ok"}
curl http://localhost:8080/readyz   # 200 or 503 if RabbitMQ down
curl http://localhost:8080/metrics  # Prometheus
```

Docker & Compose via Makefile (uses `Dockerfile`):

```bash
make gateway-build            # docker build
make gateway-up               # gateway + RabbitMQ + UI
make gateway-up WITH_UI=0     # gateway + RabbitMQ without UI
make gateway-up WITH_RABBITMQ=0 # gateway only (external RABBITMQ_URL)
make gateway-logs             # logs -f payment-gateway
make gateway-down             # down (keep volume)
make gateway-down-v           # down -v (clean)
```

Self-contained load:

```bash
PADDLE_WEBHOOK_SECRET=test INTERNAL_API_KEY=test make load-test
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
