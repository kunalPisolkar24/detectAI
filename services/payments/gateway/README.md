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
    Paddle -- POST /webhook/paddle<br/>Paddle-Signature --> GW[Gateway<br/>gin :8080]
    WebApp -- POST /internal/events<br/>X-Internal-Key --> GW
    GW -- PublishWithDeferredConfirm<br/>Persistent --> RMQ[(RabbitMQ<br/>payment_events)]
    RMQ -- DLX --> DLQ[(payment_events_dlq)]
    RMQ -- retry_exchange<br/>TTL 5s --> RQ[(payment_events_retry)] -- dead-letter --> RMQ
    RMQ --> Worker[worker-payments]
    Worker --> DB[(Postgres)]
```

```mermaid
sequenceDiagram
    participant Paddle
    participant GW as Gateway handler.go:61
    participant Val as HMAC signature.go:49
    participant RMQ as RabbitMQ producer.go:38
    Paddle->>GW: POST /webhook/paddle<br/>Paddle-Signature: ts=...;h1=...
    GW->>Val: ts/h1 regex, ±5min, HMAC SHA256 ts:body
    alt invalid
        GW-->>Paddle: 401 Invalid signature
    else valid
        GW->>RMQ: Publish queueName<br/>Confirm false
        RMQ-->>GW: Acked
        GW-->>Paddle: 200 queued
    end
```

```mermaid
graph TB
    MainQ[ payment_events<br/>x-dead-letter=dlx ] -->|nack transient<br/>x-retry <5| --> Rex[ payment_events_retry_exchange<br/>direct ]
    Rex --> RQ[ payment_events_retry<br/>TTL 5000<br/>dead-letter -> payment_events ]
    RQ -- expiry --> MainQ
    MainQ -->|nack non-retryable<br/>or >=5| DLX[ payment_events_dlx ]
    DLX --> DLQ[ payment_events_dlq ]
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

## Design Decisions

- **HMAC** `tsStr + ":" + body` SHA256 `signature.go:49`, `ts`/`h1` regex `signature.go:18`, `±5min` `signature.go:45`, `hmac.Equal` `L53`.
- **Direct publish** `""` `queueName` `producer.go:38`, DLQ via `x-dead-letter-exchange` `dlx` `producer.go:61`.
- **Retry** `x-message-ttl 5000` `producer.go:68` → `MaxRetries 5` `RabbitMQWorker.ts`, `406` log suggests `payment_events_v2`.
- **No idempotency** in gateway — stateless, `event_id` dedup downstream (`IdempotencyStore`).

## Observability

- **Logs** `slog` JSON `logger.go:17`
- **Metrics** `monitoring.go:41` 15 families: `http_requests_total{method,route,status_code}`, `payment_events_published_total{event_type,status}`, `payment_webhooks_received_total{event_type}`, `rabbitmq_*`, `gateway_build_info{version,commit}` `main.go:39`
- **Tracing** `otel.Tracer("gateway/payment-service")` `service.go:36` `event_type`/`event_id`/`source`, `otelgin` `main.go:61`, OTLP HTTP if endpoint set
- **Build info** `go build -ldflags "-X main.buildVersion -X main.buildCommit"` `Dockerfile:13` `main.go:25`

## Development

- **Stack** `go 1.25` `go.mod:3`, `gin v1.10.0`, `amqp091-go v1.9.0`, `otel v1.46.0`, `prometheus v1.19.0`
- **Layout** `cmd/gateway/main.go` wiring `log/config/monitor/tracing/rabbitmq/service/handler` (38 files)
- **Makefile** `make build/run/test/test-coverage/test-integration/deps` `Makefile:3,9,16` + `compose.yml` / `compose.load.yml`

## Testing

```bash
go test -v ./...  # unit, mocks
go test -v -coverprofile=coverage.out ./... && go tool cover -func=coverage.out
go test -v -tags=integration ./test/integration/...  # testcontainers rabbitmq:3-management-alpine
make load-test SCENARIO=spike TARGET_VUS=100  # k6 spike/stress/soak/internal
```

Manual:

```bash
TS=$(date +%s); BODY='{"event_type":"subscription.updated","data":{"id":"sub_123"}}'
SIG=$(echo -n "$TS:$BODY" | openssl dgst -sha256 -hmac "$PADDLE_WEBHOOK_SECRET" | cut -d' ' -f2); SIG="ts=$TS;h1=$SIG"
curl -i -X POST http://localhost:8080/webhook/paddle -H "Paddle-Signature: $SIG" -d "$BODY"

curl -i -X POST http://localhost:8080/internal/events -H "X-Internal-Key: $INTERNAL_API_KEY" -d '{"event_type":"user.cancel_subscription","data":{"userId":"u"}}'
```

Integration `test/integration/integration_test.go:40` covers `internal` → queue, signed webhook byte-identical, `alert_name` legacy, `401` forged, `readyz` `503`.

## Deployment

- `EXPOSE 8080` `Dockerfile:25`, `USER appuser:10001` `Dockerfile:17`, multi-stage `golang:1.25-alpine`
- Graceful `10s` HTTP `main.go:85` + `5s` tracing `main.go:94`, `gin.Recovery` `main.go:60`

## Troubleshooting

- `503 readyz` → `IsConnected() false` `connection.go:130` (RabbitMQ `5s` reconnect `connection.go:66`)
- `401 invalid signature` → `ts` ±5min or `HMAC` fail `signature.go:45,53`
- `406 PRECONDITION_FAILED` → quorum vs classic mismatch, delete queue or `payment_events_v2` `producer.go:78`

## References

- `compose.yml` / `compose.load.yml` / `Dockerfile`
- `go.mod` / `internal/monitoring/monitoring.go`
- `internal/infrastructure/paddle/signature_test.go` / `internal/transport/http/handler_test.go`
