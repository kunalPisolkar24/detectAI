# Payment Gateway

Stateless Go service that validates Paddle webhooks and forwards events to RabbitMQ for `worker-payments`. No DB — raw byte passthrough with publisher confirms and DLQ.

## Overview

```
Paddle webhook ──► Gateway ──► RabbitMQ payment_events ──► worker-payments
Web app (cancel) ─┘
```

- `queueName payment_events` `cmd/gateway/main.go:23`, handles `POST /webhook/paddle` (HMAC) and `POST /internal/events` (`X-Internal-Key`) `internal/transport/http/handler.go:41`.
- Forwards raw JSON `1 MiB` limit `handler.go:62`, `5s` timeout `handler.go:79`, persistent `application/json` `infrastructure/rabbitmq/producer.go:85`.

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

- `internal/domain/service.go:35` `ProcessWebhook` vs `ProcessInternalEvent` `L73` (`event_id` span `service.go:119`).
- Quorum vs classic via `RABBITMQ_QUEUE_TYPE` `producer.go:66` (`compose.prod.yml:5` `quorum`).

## Features

- HMAC `ts:body` SHA256 ±5min `paddle/signature.go:45` `hmac.Equal` constant-time
- Body limit `1 MiB` `handler.go:62` + `5s` context
- Publisher confirms `Confirm(false)` `connection.go:97`, `PublishWithDeferredConfirmWithContext` `producer.go:38` + `RecordRabbitMQPublishDuration`
- Topology `dlx`/`dlq` + `retry` `TTL 5000` `producer.go:46` + `406` hint `payment_events_v2` `producer.go:78`
- Reconnect `5s` `connection.go:66` + `readyz` `503` `handler.go:52`
- OTel `tracer` `service.go:18` + `otelgin` `main.go:61`, Prometheus `monitoring.go:41` (15 families)

## Quick Start

```bash
go 1.25  # go.mod:3  golang:1.25-alpine Dockerfile:1

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
docker compose up --build  # compose.yml:8 expects PADDLE_WEBHOOK_SECRET, INTERNAL_API_KEY
```

Self-contained load:

```bash
PADDLE_WEBHOOK_SECRET=test INTERNAL_API_KEY=test make load-test  # compose.load.yml:17
```

## Configuration

| Variable | Required | Default | Where |
|---|---|---|---|
| `PADDLE_WEBHOOK_SECRET` | yes | — | `config.go:30` HMAC |
| `INTERNAL_API_KEY` | yes | — | `config.go:32` `X-Internal-Key` `handler.go:97` |
| `RABBITMQ_URL` | no | `amqp://guest:guest@rabbitmq:5672/` | `config.go:24` `main.go:47` |
| `RABBITMQ_QUEUE_TYPE` | no | `classic` | `config.go:25` `producer.go:66` quorum |
| `PORT` | no | `8080` | `config.go:36` `main.go:68` `Dockerfile:25` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | — (disables) | `tracing.go:16` |
| `OTEL_SERVICE_NAME` | no | `payment-gateway` | `tracing.go:20` |

`GIN_MODE=release` `compose.yml:13`. `.env.example` currently only `PADDLE_WEBHOOK_SECRET`.

## API

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| `GET` | `/healthz` | none | `200 {"status":"ok"}` | — |
| `GET` | `/readyz` | none | `200 {"status":"ok","service":"gateway"}` if `IsConnected()` | `503 {"status":"error","rabbitmq":"disconnected"}` |
| `GET` | `/metrics` | none | Prometheus | — |
| `POST` | `/webhook/paddle` | `Paddle-Signature` | `200 {"status":"queued"}` | `400 too_large/unreadable`, `401 invalid signature`, `500` |
| `POST` | `/internal/events` | `X-Internal-Key` | `200 {"status":"queued"}` | `401 unauthorized`, `400`, `500` |

Body is raw `[]byte` `application/json` stored `Persistent` `producer.go:85`. See `handler.go:41` routes.

## Testing

```bash
make test              # go test -v ./...
make test-coverage     # go test -v -coverprofile=coverage.out ./... + go tool cover -func
make test-integration  # go test -v -tags=integration ./test/integration/... (testcontainers)
make load-test SCENARIO=spike TARGET_VUS=100  # k6 spike/stress/soak/internal
```


