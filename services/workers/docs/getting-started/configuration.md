# Configuration

This document explains how to configure the Workers service for `ENV_TYPE=dev` (local compose) and `ENV_TYPE=prod` (AWS).

## How Configuration Works

Each worker loads its own config schema that extends a shared base. All configuration is validated with Zod at startup — invalid config causes an immediate exit with a clear error.

```mermaid
graph LR
    ENV[Environment Variables] --> Base[Base Schema]
    ENV --> Worker[Worker Schema]
    Base --> Validated[Validated Config]
    Worker --> Validated
    Validated --> App[Worker App]
```

* **ENV_TYPE=dev** — loads `.env` file from `infra/` directory (or `infra/.env.example` as fallback), applies dev defaults, validates.
* **ENV_TYPE=prod** — loads secrets from AWS Secrets Manager and parameters from SSM, validates with strict prod checks.

Precedence: Shell environment > `.env` file > Dev defaults.

## Env Type

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | Canonical switch. `dev` = local docker-compose with `.env`; `prod` = AWS Secrets Manager + SSM. Must be `dev` or `prod`. |

## Base Configuration (All Workers)

These variables are shared by all three workers:

### Required

| Var | Default | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgresql://user:password@postgres-users:5432/detect_ai` | yes | Primary PostgreSQL connection string |
| `REDIS_URL` | `redis://:user_cache_password@redis-users:6379` | yes | Redis connection string for user cache + dedup |

### Optional

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | `dev` or `prod` |
| `DATABASE_URL_REPLICA` | same as `DATABASE_URL` | no | Read replica endpoint. In dev, equals primary. In Aurora, use reader endpoint. |
| `REDIS_PASSWORD` | (extracted from URL) | no | Password for Redis. Extracted from `REDIS_URL` if empty. |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | no | RabbitMQ connection. Required in prod for payments + analytics workers. |
| `RABBITMQ_PREFETCH` | `1` | no | How many unacked messages per consumer (1-1000) |
| `INFRA_REQUEUE_DELAY_MS` | `5000` | no | Delay before infra-requeue when DB is down (0-60000) |
| `PORT` | `7777` | no | Health server port. Each worker overrides this in compose. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty) | no | OpenTelemetry collector URL. Empty disables tracing. |
| `OTEL_SERVICE_NAME` | (worker-specific) | no | Service name for traces |

## Payments Worker Configuration

Extends the base schema with Paddle and events-redis settings:

| Var | Default | Required | Notes |
|---|---|---|---|
| `PADDLE_API_KEY` | (none) | yes | Paddle API key for cancel requests |
| `PADDLE_ENVIRONMENT` | `sandbox` | no (prod: yes) | `sandbox` or `production` |
| `EVENT_REDIS_URL` | `redis://:events_password@redis-events:6379` | yes | Separate Redis for Paddle event dedup (`paddle:evt:*`, `payment:event:ts:*`) |
| `EVENT_REDIS_PASSWORD` | (extracted from URL) | no | Password for events Redis |
| `RABBITMQ_URL` | (from base) | prod: yes | Required in prod |

## Analytics Worker Configuration

Uses only the base schema. No additional variables needed.

| Var | Default | Required | Notes |
|---|---|---|---|
| `RABBITMQ_URL` | (from base) | prod: yes | Required in prod |

## Cron Worker Configuration

Extends the base schema with cron-specific tuning:

| Var | Default | Required | Notes |
|---|---|---|---|
| `CRON_CHECK_INTERVAL_MS` | `900000` (15 min) | no | How often to check for expired subscriptions (min 5000) |
| `CRON_BATCH_SIZE` | `100` | no | Max subscriptions to sweep per iteration (1-1000) |

## Health Server Ports

Each worker has a default health server port. Override via environment variables when running side by side:

| Worker | Default Port | Override Var |
|--------|-------------|--------------|
| Payments | `7003` | `WORKER_PAYMENTS_PORT` |
| Analytics | `7001` | `WORKER_ANALYTICS_PORT` |
| Cron | `7002` | `WORKER_CRON_PORT` |

## Dependency Matrix

Each worker needs a specific set of datastores. The Makefile handles this automatically:

| Worker | PostgreSQL | Redis (users) | Redis (events) | RabbitMQ |
|--------|-----------|---------------|----------------|----------|
| Payments | Yes | Yes | Yes | Yes |
| Analytics | Yes | Yes | No | Yes |
| Cron | Yes | Yes | No | No |

## Environment Examples

### Local Development (ENV_TYPE=dev)

```bash
ENV_TYPE=dev
DATABASE_URL=postgresql://user:password@localhost:5432/detect_ai
REDIS_URL=redis://:user_cache_password@localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
LOG_LEVEL=debug
```

### Docker Compose (dev)

`infra/.env.example` provides working defaults. Run with no env file:

```bash
make worker-up WORKER=payments
```

The compose files pass canonical vars with empty defaults (`${VAR:-}`):

```yaml
ENV_TYPE: ${ENV_TYPE:-dev}
DATABASE_URL: ${DATABASE_URL:-}
REDIS_URL: ${REDIS_URL:-}
RABBITMQ_URL: ${RABBITMQ_URL:-}
```

### Production (AWS)

```bash
ENV_TYPE=prod
AWS_REGION=ap-south-1
# DATABASE_URL and REDIS_URL come from AWS Secrets Manager:
#   detectai/workers/secrets
# RABBITMQ_URL comes from detectai/mq/urls
# Optional SSM params at /detectai/workers/*
```

### Floci Local Prod Test

```bash
ENV_TYPE=prod AWS_REGION=ap-south-1 AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
  make worker-up WORKER=payments
# Seed Floci: detectai/mq/urls, detectai/workers/secrets + SSM /detectai/workers/*
```

## Configuration Validation

Failed validation causes the worker to exit immediately with a descriptive error.

| Error | Cause | Fix |
|-------|-------|-----|
| `DATABASE_URL is required` | Missing PostgreSQL connection | Set `DATABASE_URL` |
| `REDIS_URL must be a valid redis:// or rediss:// URL` | Bad Redis URL | Use `redis://host:port` or `rediss://host:port` |
| `RABBITMQ_URL is required in prod` | Missing RabbitMQ in prod | Set `RABBITMQ_URL` in prod |
| `PADDLE_API_KEY is required` | Missing Paddle key (payments) | Set `PADDLE_API_KEY` |
| `PADDLE_ENVIRONMENT is required in prod` | Missing Paddle env in prod | Set `PADDLE_ENVIRONMENT=production` |
| `RABBITMQ_URL must be a valid URL` | Bad RabbitMQ URL | Use `amqp://user:pass@host:port/` |
| `CRON_CHECK_INTERVAL_MS must be >= 5000` | Interval too short | Set to 5000 or higher |
| `CRON_BATCH_SIZE must be <= 1000` | Batch too large | Set to 1000 or lower |
| `PORT must be 1-65535` | Invalid port number | Use a valid port |

## Viewing Current Configuration

The worker logs its config at startup (without secrets):

```json
{"level":"info","message":"Payments config loaded","service":"Payments","timestamp":"..."}
```

Metrics: `http://localhost:<PORT>/metrics` (default ports: 7001/7002/7003).

## Developer Workflow

The service includes a Makefile with common commands:

| Command | What It Does |
|---------|--------------|
| `make worker-up WORKER=X` | Start a worker + its datastores |
| `make worker-down WORKER=X` | Stop the stack (keep volumes) |
| `make worker-down-v WORKER=X` | Stop the stack and remove volumes |
| `make worker-logs WORKER=X` | Stream worker logs |
| `make worker-ps WORKER=X` | Show stack containers |
| `make worker-build WORKER=X` | Build the worker image |
| `make worker-config WORKER=X` | Render the compose config |
| `make dev-payments` | Start payments in watch mode (local Bun) |
| `make dev-analytics` | Start analytics in watch mode (local Bun) |
| `make dev-cron` | Start cron in watch mode (local Bun) |
| `make test` | Run unit tests |
| `make test-integration` | Run integration tests |

## Troubleshooting

**Service won't start?**
- Check `DATABASE_URL` and `REDIS_URL` are set and valid.
- In `prod`, secrets must come from AWS — not dev defaults.
- Look for validation errors in logs (worker exits immediately).

**Connection refused?**
- Ensure databases are running (`make worker-ps WORKER=X`).
- Check `RABBITMQ_URL` for payments/analytics workers.
- Verify ports are not already in use.

**Config validation fails?**
- Check the error message — it tells you exactly which variable is wrong.
- In `prod`, ensure AWS Secrets Manager and SSM are seeded.

## Related Documentation

- [Architecture](../concepts/architecture.md) — How components connect
- [Message Flows](../concepts/message-flows.md) — How events are processed
- [Health](../operations/health.md) — How to check if configuration is working
- [Observability](../operations/observability.md) — Monitor configuration impact
