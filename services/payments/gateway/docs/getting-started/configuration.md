# Configuration

This document explains how to configure the Payment Gateway service for different environments.

## How Configuration Works

The gateway uses a **chain provider** pattern that loads configuration in a specific order based on your environment. Think of it like a priority list - the most specific setting wins.

```mermaid
graph TB
    ENV[ENV_TYPE] -->|dev| Dev[Load from .env file]
    ENV -->|prod| Prod[Load from AWS Secrets Manager]
    Dev --> Validate[Validate Config]
    Prod --> Validate
    Validate --> Run[Start Gateway]
```

**Why two modes?**
- **Dev mode**: Fast iteration with local `.env` files
- **Prod mode**: Secure secrets from AWS, strict validation, no default credentials

## Environment Variables

### Required Variables

| Variable | Description | Example | Why Required |
|----------|-------------|---------|--------------|
| `ENV_TYPE` | Environment mode: `dev` or `prod` | `dev` | Determines config source |
| `PADDLE_WEBHOOK_SECRET` | HMAC secret for Paddle webhooks | `whsec_abc123...` | Validates webhook signatures |
| `INTERNAL_API_KEY` | API key for internal events | `s3cr3t_k3y_12345` | Authenticates internal requests |

### Optional Variables

| Variable | Default | Description | Why Use It |
|----------|---------|-------------|------------|
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | RabbitMQ connection string | Connect to external broker |
| `RABBITMQ_QUEUE_TYPE` | `quorum` | Queue type: `classic` or `quorum` | Use quorum for HA |
| `PORT` | `8080` | HTTP listen port | Custom port |
| `GIN_MODE` | `release` | Gin mode: `debug`, `release`, `test` | Debug mode |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` | Verbose logging |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | OpenTelemetry endpoint | Enable tracing |
| `OTEL_SERVICE_NAME` | `payment-gateway` | OTel service name | Tracing identification |
| `AWS_REGION` | `ap-south-1` | AWS region | AWS secrets access |

## Configuration Validation

The gateway validates all configuration at startup. If validation fails, the service exits immediately with a clear error message.

**Why validate early?**
- Catch configuration errors before they cause runtime issues
- Prevent running with insecure defaults in production
- Ensure all required secrets are present

### Validation Rules

| Variable | Rule | Error Message |
|----------|------|---------------|
| `ENV_TYPE` | Must be `dev` or `prod` | `ENV_TYPE must be dev or prod, got "X"` |
| `PADDLE_WEBHOOK_SECRET` | Non-empty, 16+ characters | `PADDLE_WEBHOOK_SECRET must be at least 16 characters` |
| `INTERNAL_API_KEY` | Non-empty, 16+ characters | `INTERNAL_API_KEY must be at least 16 characters` |
| `RABBITMQ_URL` | Valid AMQP/AMQPS URL | `RABBITMQ_URL scheme must be amqp or amqps` |
| `RABBITMQ_QUEUE_TYPE` | `classic` or `quorum` | `RABBITMQ_QUEUE_TYPE must be classic or quorum` |
| `PORT` | 1-65535 | `PORT must be 1-65535` |
| `GIN_MODE` | `debug`, `release`, or `test` | `GIN_MODE must be debug, release or test` |

## Dev Mode Configuration

When `ENV_TYPE=dev`, the gateway loads configuration from environment variables or `.env` files.

### Loading Order

1. **Environment variables** (highest priority)
2. **`.env` file** in the gateway directory
3. **`.env` file** specified by `ENV_FILE` variable
4. **Default values** (lowest priority)

### Dev Defaults

| Variable | Default Value | Why |
|----------|---------------|-----|
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | Local Docker RabbitMQ |
| `RABBITMQ_QUEUE_TYPE` | `quorum` | Modern queue type |
| `PORT` | `8080` | Standard HTTP port |
| `GIN_MODE` | `release` | Production-like behavior |
| `LOG_LEVEL` | `info` | Standard logging |
| `OTEL_SERVICE_NAME` | `payment-gateway` | Identifies service in traces |
| `AWS_REGION` | `ap-south-1` | Default AWS region |

### Example `.env` File

```bash
# Required
PADDLE_WEBHOOK_SECRET=whsec_your_secret_here_min_16_chars
INTERNAL_API_KEY=your_internal_api_key_min_16

# Optional (defaults shown)
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672/
RABBITMQ_QUEUE_TYPE=quorum
PORT=8080
GIN_MODE=release
LOG_LEVEL=info
```

## Production Mode Configuration

When `ENV_TYPE=prod`, the gateway loads secrets from AWS and applies strict validation.

### AWS Secrets Loading

The gateway loads secrets from two AWS sources:

1. **AWS Secrets Manager** (`detectai/mq/urls`):
   - `RABBITMQ_URL` - RabbitMQ connection string (AMQPS)

2. **AWS Secrets Manager** (`detectai/gateway/secrets`):
   - `PADDLE_WEBHOOK_SECRET` - Paddle webhook HMAC secret
   - `INTERNAL_API_KEY` - Internal API authentication key

### SSM Parameter Store

Optional parameters can be loaded from AWS SSM:

- **SSM Prefix**: Set `SSM_PREFIX` to load parameters with that prefix

### Production Validation

In addition to standard validation, production mode enforces:

| Rule | Error Message |
|------|---------------|
| Must have `AWS_REGION` | `ENV_TYPE=prod requires AWS_REGION` |
| Must have all secrets | `ENV_TYPE=prod requires secrets from AWS` |
| No default RabbitMQ URL | `ENV_TYPE=prod must not use default dev RabbitMQ URL` |

**Why strict validation?**
- Prevent accidental use of development credentials
- Ensure all secrets are properly loaded from secure storage
- Avoid running with insecure defaults

### Example Production Configuration

```bash
# Production environment
ENV_TYPE=prod
AWS_REGION=ap-south-1

# AWS loads these automatically:
# PADDLE_WEBHOOK_SECRET=whsec_prod_secret
# INTERNAL_API_KEY=prod_internal_key
# RABBITMQ_URL=amqps://user:pass@rabbitmq.example.com:5671

# Optional overrides
PORT=8080
GIN_MODE=release
LOG_LEVEL=info
```

## Docker Compose Configuration

The gateway uses Docker Compose for local development. The compose file reads environment variables and passes them to the container.

### Compose Files

| File | Purpose | Use Case |
|------|---------|----------|
| `infra/compose.yml` | Gateway only | Running gateway with external RabbitMQ |
| `infra/docker/rabbitmq/standalone.yml` | RabbitMQ atom | Shared RabbitMQ instance |
| `infra/docker/rabbitmq/management.yml` | RabbitMQ UI overlay | Adds management interface |
| `infra/compose.load.yml` | Load testing | Isolated k6 tests |

### Running with Compose

```bash
# Gateway + RabbitMQ + Management UI (default)
make gateway-up

# Gateway only (needs external RabbitMQ)
make gateway-up WITH_RABBITMQ=0 RABBITMQ_URL=amqp://user:pass@host:5672/

# Gateway + RabbitMQ without UI
make gateway-up WITH_UI=0
```

### Environment Variable Passthrough

The compose file passes these variables to the container:

```yaml
environment:
  - ENV_TYPE=${ENV_TYPE:-dev}
  - RABBITMQ_URL=${RABBITMQ_URL:-}
  - RABBITMQ_QUEUE_TYPE=${RABBITMQ_QUEUE_TYPE:-}
  - PADDLE_WEBHOOK_SECRET=${PADDLE_WEBHOOK_SECRET:-}
  - INTERNAL_API_KEY=${INTERNAL_API_KEY:-}
  - PORT=${PORT:-8080}
  - GIN_MODE=${GIN_MODE:-release}
  - OTEL_EXPORTER_OTLP_ENDPOINT=${OTEL_EXPORTER_OTLP_ENDPOINT:-}
  - OTEL_SERVICE_NAME=${OTEL_SERVICE_NAME:-payment-gateway}
  - AWS_REGION=${AWS_REGION:-}
```

## Queue Type Selection

### Classic vs Quorum

| Aspect | Classic Queue | Quorum Queue |
|--------|---------------|--------------|
| **Durability** | Optional | Always durable |
| **Replication** | Single node | Multi-node (Raft) |
| **Memory** | Lower | Higher |
| **Performance** | Higher throughput | Lower latency |
| **Use Case** | Development | Production |

**Why quorum in production?**
- Data survives node failures
- Messages are replicated across 3 nodes
- Required for Amazon MQ `CLUSTER_MULTI_AZ`

### When to Use Each

| Environment | Queue Type | Why |
|-------------|------------|-----|
| Local development | `quorum` | Matches production behavior |
| CI/CD testing | `quorum` | Catches queue-specific issues |
| Production (standalone) | `quorum` | High availability |
| Production (cluster) | `quorum` | Raft replication |

## Port Configuration

### Default Ports

| Service | Port | Purpose |
|---------|------|---------|
| Gateway | `8080` | HTTP API |
| RabbitMQ | `5672` | AMQP protocol |
| RabbitMQ UI | `15672` | Management interface |

### Load Testing Ports

Load tests use different ports to run side-by-side with the main stack:

| Service | Main Port | Load Port |
|---------|-----------|-----------|
| RabbitMQ | `5672` | `5673` |
| RabbitMQ UI | `15672` | `15673` |

## Related Documentation

- [Quick Start](quickstart.md) - Get the service running
- [Architecture](../concepts/architecture.md) - How configuration fits in the system
- [Health](../operations/health.md) - Health check configuration
- [Observability](../operations/observability.md) - Monitoring configuration
