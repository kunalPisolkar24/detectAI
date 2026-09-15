# Payment Gateway

Stateless Go service that validates Paddle webhooks and forwards events to RabbitMQ for `worker-payments`. No DB — raw byte passthrough with publisher confirms and DLQ.

## Overview

The Payment Gateway is a secure entry point for payment events. It:

- **Receives webhooks from Paddle** and validates their HMAC signatures
- **Accepts internal events** from your web application
- **Forwards events to RabbitMQ** for downstream processing
- **Fast-fails** when RabbitMQ is down (no buffering)

Think of it as a **secure mailroom** that checks IDs before forwarding packages to the right department.

## Quick Start

```bash
# Navigate to gateway directory
cd services/payments/gateway

# Start gateway with RabbitMQ
make gateway-up

# Test health
curl http://localhost:8080/healthz

# Send test event
curl -X POST http://localhost:8080/internal/events \
  -H "X-Internal-Key: test_internal_key" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"subscription.updated","event_id":"evt_123"}'

# Stop gateway
make gateway-down
```

See [Quick Start](docs/getting-started/quickstart.md) for detailed instructions.

## Documentation

| Category | Document | What You'll Learn |
|----------|----------|-------------------|
| **Getting Started** | [Quick Start](docs/getting-started/quickstart.md) | Run the service locally |
| | [Configuration](docs/getting-started/configuration.md) | All settings and environment variables |
| **Concepts** | [Architecture](docs/concepts/architecture.md) | How the service is built and why |
| | [Request Flows](docs/concepts/request-flows.md) | How requests move through the system |
| | [Message Delivery](docs/concepts/message-delivery.md) | RabbitMQ topology and reliability |
| **Components** | [API Reference](docs/components/api.md) | HTTP endpoints and status codes |
| | [Validation](docs/components/validation.md) | HMAC signature and API key validation |
| **Operations** | [Health](docs/operations/health.md) | Health checks and monitoring |
| | [Observability](docs/operations/observability.md) | Metrics, alerts, and dashboards |
| **Testing** | [Testing Overview](docs/testing/overview.md) | Testing strategy and commands |
| | [Unit Tests](docs/testing/unit.md) | Testing individual components |
| | [Integration Tests](docs/testing/integration.md) | Testing with real RabbitMQ |
| | [Load Tests](docs/testing/load.md) | Performance testing with k6 |

Full documentation index: [docs/README.md](docs/README.md)

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

**Key features:**
- **Stateless** - No database, easy to scale
- **Fast-fail** - Returns 503 when RabbitMQ is down
- **Secure** - HMAC validation for Paddle, API key for internal events
- **Reliable** - Publisher confirms ensure message delivery

See [Architecture](docs/concepts/architecture.md) for details.

## API

| Method | Path | Purpose | Success | Errors |
|--------|------|---------|---------|--------|
| `GET` | `/healthz` | Liveness check | `200` | - |
| `GET` | `/readyz` | Readiness check | `200` | `503` if RabbitMQ down |
| `GET` | `/metrics` | Prometheus metrics | `200` | - |
| `POST` | `/webhook/paddle` | Paddle webhook | `200 queued` | `400`, `401`, `503`, `500` |
| `POST` | `/internal/events` | Internal event | `200 queued` | `400`, `401`, `503`, `500` |

**503 = fast-fail** when RabbitMQ is down. Includes `Retry-After: 5` header.

See [API Reference](docs/components/api.md) for details.

## Configuration

```bash
# Required
PADDLE_WEBHOOK_SECRET=whsec_...    # Paddle HMAC secret
INTERNAL_API_KEY=s3cr3t            # Internal API key

# Optional
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/
RABBITMQ_QUEUE_TYPE=quorum         # classic or quorum
PORT=8080
ENV_TYPE=dev                       # dev or prod
```

See [Configuration](docs/getting-started/configuration.md) for full reference.

## Testing

```bash
# Unit tests
make test

# Integration tests (needs Docker)
make test-integration

# HA tests (3-node cluster)
make test-integration-ha

# Load tests (k6)
make load-test
```

See [Testing Overview](docs/testing/overview.md) for details.

## Docker

```bash
# Build image
make gateway-build

# Start with RabbitMQ
make gateway-up

# Start without RabbitMQ (needs external broker)
make gateway-up WITH_RABBITMQ=0 RABBITMQ_URL=amqp://user:pass@host:5672/

# View logs
make gateway-logs

# Stop
make gateway-down
```

## Monitoring

- **Health checks**: `/healthz` and `/readyz`
- **Metrics**: `/metrics` (Prometheus)
- **Logs**: JSON to stdout
- **Tracing**: OpenTelemetry (optional)

See [Observability](docs/operations/observability.md) for metrics and alerts.

## Related Files

- **Makefile**: Build and test commands
- **Docker Compose**: Local development setup
- **Load Testing**: k6 load test scenarios
- **Go Module**: `go.mod` for dependencies
