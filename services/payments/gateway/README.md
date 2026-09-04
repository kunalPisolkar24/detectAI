# Payment Gateway

Stateless Go service that validates Paddle webhooks and forwards events to RabbitMQ for `worker-payments`. No DB — raw byte passthrough with publisher confirms and DLQ.

## Overview

Stateless service handling `POST /webhook/paddle` (HMAC) and `POST /internal/events` (`X-Internal-Key`), forwarding raw JSON with `1 MiB` limit, `5s` timeout, persistent `application/json`.

## Packages

| Package | Purpose |
|---|---|
| `gin` | HTTP router |
| `amqp091-go` | RabbitMQ |
| `prometheus` | Metrics |
| `otel`, `otel/sdk`, `otelgin`, `otlptracehttp` | Tracing |
| `sonic`, `goccy/go-json`, `json-iterator` | JSON |
| `validator`, `locales`, `universal-translator`, `mimetype`, `go-urn` | Validation |
| `grpc`, `protobuf`, `genproto` | gRPC |
| `crypto`, `net`, `sys`, `text`, `arch` | Crypto |
| `compress`, `xxhash`, `perks` | Prometheus internals |
| `testcontainers`, `rabbitmq` | Integration |
| `testify` | Mocks |

See `go.mod` for full list.

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

`ProcessWebhook` vs `ProcessInternalEvent` with `event_id` tracing; quorum vs classic via `RABBITMQ_QUEUE_TYPE`. See [Architecture](docs/01-architecture.md) for sequence and DLQ class view.

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

See `docs/08-configuration.md` for full reference.

## API

```text
GET  /healthz          -> 200 {"status":"ok"}
GET  /readyz           -> 200 or 503 if RabbitMQ down
GET  /metrics          -> Prometheus
POST /webhook/paddle   (Paddle-Signature) -> 200 queued | 400 401 500
POST /internal/events  (X-Internal-Key)   -> 200 queued | 401 400 500
```

See `docs/09-api.md` for validation and error codes.

## Observability

Logs are JSON to stdout. Tracing is OTel if an OTLP endpoint is set. Metrics at GET /metrics for Prometheus.

Metrics configured:

- HTTP requests total — counts every request by method, route and status code
- HTTP request duration — measures how long each request takes
- Payment webhooks received — counts valid Paddle webhooks by event type
- Invalid signatures — counts HMAC failures
- Published events — counts forwards to RabbitMQ by event type and status
- RabbitMQ connection status — shows if gateway is connected to RabbitMQ

Alerts configured:

- Gateway down — gateway not up for more than 1 minute
- RabbitMQ down — gateway cannot reach RabbitMQ for more than 1 minute
- High invalid signatures — more than 1 bad signature every 10 seconds for 5 minutes
- High publish latency — RabbitMQ publish p95 taking more than half a second for 5 minutes
- DLQ depth — more than 10 messages stuck in dead letter queue for 5 minutes
- Retry queue depth — more than 50 messages waiting to retry for 5 minutes

See `docs/10-observability.md` for PromQL.

## Testing

All test commands are wrapped with `make` — check `Makefile` for details.

```bash
# Run unit tests
make test

# Run tests with coverage report
make test-coverage

# Run integration tests (needs Docker)
make test-integration

# Run load tests
make load-test
```

See `docs/11-testing.md` and `test/load/README.md` for scenarios.

## Docker

All Docker commands are wrapped with `make` for simplicity.

```bash
# Build the gateway image
make gateway-build

# Start gateway with RabbitMQ and management UI (default)
make gateway-up

# Start gateway only, without RabbitMQ
make gateway-up WITH_RABBITMQ=0

# View live logs and running containers
make gateway-logs
make gateway-ps

# Stop and clean up
make gateway-down
make gateway-down-v
```

## Documentation

| Guide | What |
|---|---|
| [Architecture](docs/01-architecture.md) | High-level, sequence, DLQ, class view |
| [Validation](docs/02-validation.md) | HMAC, timestamp, internal key flow |
| [Internals](docs/03-internals.md) | RabbitMQ adapter, retry/DLQ, quorum |
| [Configuration](docs/08-configuration.md) | Full env reference |
| [API](docs/09-api.md) | Endpoints, status codes |
| [Observability](docs/10-observability.md) | Metrics, alerts, dashboards |
| [Testing](docs/11-testing.md) | Unit, integration, load |

Full index: [docs/README.md](docs/README.md).
