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

Docker:

```bash
docker build -t payment-gateway --build-arg VERSION=1.0 --build-arg COMMIT=$(git rev-parse --short HEAD) .
docker run -p 8080:8080 -e PADDLE_WEBHOOK_SECRET -e INTERNAL_API_KEY -e RABBITMQ_URL=amqp://host.docker.internal:5672/ payment-gateway
```

Compose (integrated, needs `detect_ai_network`):

```bash
docker compose up --build
```

Self-contained load:

```bash
PADDLE_WEBHOOK_SECRET=test INTERNAL_API_KEY=test make load-test
```

## Configuration

- **`PADDLE_WEBHOOK_SECRET`** — required
  - *Default:* —
  - HMAC validation

- **`INTERNAL_API_KEY`** — required
  - *Default:* —
  - `X-Internal-Key` auth for internal events

- **`RABBITMQ_URL`** — optional
  - *Default:* `amqp://guest:guest@rabbitmq:5672/`

- **`RABBITMQ_QUEUE_TYPE`** — optional
  - *Default:* `classic` (use `quorum` in prod)

- **`PORT`** — optional
  - *Default:* `8080`

- **`OTEL_EXPORTER_OTLP_ENDPOINT`** — optional
  - *Default:* — (disables tracing)

- **`OTEL_SERVICE_NAME`** — optional
  - *Default:* `payment-gateway`

`GIN_MODE=release`. `.env.example` currently only `PADDLE_WEBHOOK_SECRET`.

## API

### `GET /healthz`
- **Auth:** none
- **Success:** `200 {"status":"ok"}`
- **Errors:** —

### `GET /readyz`
- **Auth:** none
- **Success:** `200 {"status":"ok","service":"gateway"}` if RabbitMQ connected
- **Errors:** `503 {"status":"error","rabbitmq":"disconnected"}`

### `GET /metrics`
- **Auth:** none
- **Success:** Prometheus exposition
- **Errors:** —

### `POST /webhook/paddle`
- **Auth:** `Paddle-Signature`
- **Success:** `200 {"status":"queued"}`
- **Errors:** `400 too_large/unreadable`, `401 invalid signature`, `500`

### `POST /internal/events`
- **Auth:** `X-Internal-Key`
- **Success:** `200 {"status":"queued"}`
- **Errors:** `401 unauthorized`, `400`, `500`

Body is raw `application/json` stored `Persistent`.

## Testing

```bash
make test              # go test -v ./...
make test-coverage     # go test -v -coverprofile=coverage.out ./... + go tool cover -func
make test-integration  # go test -v -tags=integration ./test/integration/... (testcontainers)
make load-test SCENARIO=spike TARGET_VUS=100  # k6 spike/stress/soak/internal
```
