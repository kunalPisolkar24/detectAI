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

* **ENV_TYPE=dev** — loads a `.env` file from the working directory (or the file named by `ENV_FILE`), applies dev defaults, validates.
* **ENV_TYPE=prod** — loads secrets from AWS Secrets Manager and parameters from SSM, validates with strict prod checks.

**Precedence in dev:** Shell environment > `.env` file > dev defaults.

**Precedence in prod:** Shell environment > AWS Secrets Manager > AWS SSM.

Under Docker Compose there is no `.env` file to read inside the container. The Makefile passes `--env-file infra/.env` (falling back to `infra/.env.example`) to `docker compose`, so the values arrive as environment variables and the shell-environment rule applies.

**`CONFIG_SOURCE` is deprecated.** It used to select between `env` and `aws`. Use `ENV_TYPE=dev|prod` instead. Setting it still works, but logs a warning.

**How `ENV_TYPE` is decided**, in order:
1. `ENV_TYPE`, if set
2. `CONFIG_SOURCE` (deprecated)
3. `NODE_ENV` — `production` means `prod`, `test` means `dev`
4. `dev`

## Env Type

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | Canonical switch. `dev` = local docker-compose with `.env`; `prod` = AWS Secrets Manager + SSM. Must be `dev` or `prod`. |

## Base Configuration (All Workers)

These variables are shared by all three workers:

### Required

| Var | Default | Required | Notes |
|---|---|---|---|
| `DATABASE_URL` | none | yes | Primary PostgreSQL connection string |
| `REDIS_URL` | none | yes | Redis connection string for user cache + dedup |

These two have **no default in code**. If they are missing, the worker exits immediately with a validation error. The Makefile and the compose files supply working local values, so `make worker-up` works without setting them by hand.

### Optional

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | `dev` or `prod` |
| `DATABASE_URL_REPLICA` | same as `DATABASE_URL` | no | Read replica endpoint. In dev, equals primary. In Aurora, use reader endpoint. **Set it, do not leave it blank** — an empty value fails validation. |
| `REDIS_PASSWORD` | (empty) | no | Password for Redis. When empty, ioredis uses the password embedded in `REDIS_URL`. |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` in dev | no | RabbitMQ connection. Required in prod for payments + analytics workers. |
| `RABBITMQ_PREFETCH` | `1` | no | How many unacked messages per consumer (1-1000). The Payments worker overrides this to `10`. |
| `INFRA_REQUEUE_DELAY_MS` | `5000` | no | Delay before infra-requeue when DB is down (0-60000) |
| `PORT` | `7777` | no | Health server port. Each worker overrides this in compose. |
| `POOL_MAX` | `5` | no | Maximum PostgreSQL connections per pool. Read directly from the environment, not validated by the schema. Only the Payments compose stack forwards it — `POOL_MAX=10 make worker-up WORKER=analytics` has no effect. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (empty) | no | OpenTelemetry collector URL. Empty disables tracing. |
| `OTEL_SERVICE_NAME` | (worker-specific) | no | Service name for traces |
| `AWS_REGION` | `ap-south-1` | no | Used when loading configuration from AWS. |
| `ENV_FILE` | (empty) | no | Path to a `.env` file to load when there is no `.env` in the working directory. |

**A blank `DATABASE_URL_REPLICA` is a startup failure.** The variable is optional in the schema, but an *empty* value is not the same as an unset one — it fails URL validation with `Invalid URL`. Docker Compose substitutes an empty string for a variable that is not set, so removing the line from `infra/.env` makes the worker exit immediately. The "same as `DATABASE_URL`" fallback is applied further down, in `PrismaService`, not by the config layer.

## Payments Worker Configuration

Extends the base schema with Paddle and events-redis settings:

| Var | Default | Required | Notes |
|---|---|---|---|
| `PADDLE_API_KEY` | (none) | yes | Paddle API key for cancel requests |
| `PADDLE_ENVIRONMENT` | `sandbox` | no (prod: yes) | `sandbox` or `production` |
| `EVENT_REDIS_URL` | (none) | yes | Separate Redis for Paddle event dedup (`paddle:evt:*`) and event ordering (`payment:event:ts:*`) |
| `EVENT_REDIS_PASSWORD` | (empty) | no | Password for events Redis. When empty, ioredis uses the password embedded in `EVENT_REDIS_URL`. |
| `RABBITMQ_URL` | (from base) | prod: yes | Required in prod |

Load-tested guidance (payments only): default `RABBITMQ_PREFETCH` is `10`, which
sustains ~120rps with zero DLQ/retries on a single worker with the default pool,
while `1` tops out at ~60rps with unbounded queue growth. Ordering and idempotency
are enforced by the DB row lock and dedup stores, not by `prefetch=1`, so the
higher default does not weaken consistency. Override per deploy via environment
(`RABBITMQ_PREFETCH=20 make worker-up WORKER=payments`, also tested clean) and
verify with
`make load-test WORKER=payments VUS=40 DURATION=60s RPS=120 RABBITMQ_PREFETCH=10`.
Analytics keeps the base default `1` until separately tested.

Single-box follow-up (3-minute runs, one worker): with `POOL_MAX=10` (env-only,
default stays `5`) the same worker drains ~150rps clean with zero DLQ/retries;
past ~150–160rps it backlogs no matter the prefetch (pool contention past 10
slots just inflates latency). Scale replicas beyond that; see PR #303 for the
full matrix.

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
| `Invalid input: expected string, received undefined` on `DATABASE_URL` | Missing PostgreSQL connection | Set `DATABASE_URL` |
| `REDIS_URL must be a valid redis:// or rediss:// URL` | Bad Redis URL | Use `redis://host:port` or `rediss://host:port` |
| `RABBITMQ_URL is required in prod` | Missing RabbitMQ in prod | Set `RABBITMQ_URL` in prod |
| `Invalid input: expected string, received undefined` on `PADDLE_API_KEY` | Missing Paddle key (payments) | Set `PADDLE_API_KEY` |
| `PADDLE_ENVIRONMENT is required in prod` | Missing Paddle env in prod | Set `PADDLE_ENVIRONMENT=production` |
| `Invalid URL` on `RABBITMQ_URL` | Bad RabbitMQ URL | Use `amqp://user:pass@host:port/` |
| `Too small: expected number to be >=5000` on `CRON_CHECK_INTERVAL_MS` | Interval too short | Set to 5000 or higher |
| `Too big: expected number to be <=1000` on `CRON_BATCH_SIZE` | Batch too large | Set to 1000 or lower |
| `Too small: expected number to be >=1` on `PORT` | Invalid port number | Use a valid port |
| `ENV_TYPE=prod must not use default dev RabbitMQ URL` | The dev `guest:guest` URL leaked into prod | Load `RABBITMQ_URL` from AWS |
| `ENV_TYPE=prod requires RABBITMQ_URL from AWS (detectai/mq/urls) or SSM` | Nothing supplied a broker URL | Seed the MQ secret |
| `ENV_TYPE=prod requires PADDLE_API_KEY from AWS (detectai/workers/secrets)` | Nothing supplied the Paddle key | Seed the workers secret |

The first nine rows come from the Zod schema, and the wording is Zod's own — so a missing field says `Invalid input: expected string, received undefined` rather than naming the variable in the message. The variable is the *path* in the error object, not the text. The last three are extra checks that only run in prod.

## Viewing Current Configuration

The worker logs the fact that it loaded its configuration at startup (without any secrets):

```json
{"level":"info","message":"Environment variables loaded for [Payments] worker","envType":"dev","timestamp":"..."}
```

If validation fails, the same worker name appears in the error, along with every field that was wrong. Zod nests its messages under `_errors`:

```json
{"level":"error","message":"Invalid environment variables for [Payments] worker","errors":{"_errors":[],"PADDLE_API_KEY":{"_errors":["Invalid input: expected string, received undefined"]},"PORT":{"_errors":["Too small: expected number to be >=1"]}},"timestamp":"..."}
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
| `make test-integration-ha` | Run the high-availability integration tests |
| `make load-test WORKER=X` | Run the containerized k6 load rig |
| `make load-check WORKER=X` | Run a small correctness profile (~60 requests) that must pass locally |
| `make load-down WORKER=X` | Tear down the load rig |
| `make proxy` | Start the load-test proxy on the host |

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
