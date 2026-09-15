# Configuration

This document explains how to configure the Chats service for `ENV_TYPE=dev` (local compose) and `ENV_TYPE=prod` (AWS).

## Env Type

| Var | Default | Required | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | no | Canonical switch. `dev` = local docker-compose with `.env` / `ENV_FILE`; `prod` = AWS Secrets Manager + SSM. `development`→`dev`, `production`→`prod` aliases accepted, otherwise must be `dev` or `prod`. |

`APP_ENV` is **not** read — removed in favour of single `ENV_TYPE` (no deprecated alias).

## How Configuration Works

* `ENV_TYPE=dev` — loads `.env` in CWD if present, else `$ENV_FILE` (best-effort via `godotenv`), applies dev defaults, validates.
* `ENV_TYPE=prod` — loads Secrets Manager + SSM via `aws-sdk-go-v2` (`internal/config/aws.go`), applies non-secret env overrides, then validates with strict prod checks.

Precedence: `process env` (for SSM skip) > `cfg` (AWS) > `prod non-secret overrides` > `Validate` defaults. Empty strings never override (compose passthrough `${VAR:-}`).

## Required Configuration

```bash
SERVICE_ROLE=api          # or 'worker' — required in both dev and prod
MONGO_URI=mongodb://mongo-chat:27017
CHAT_REDIS_ADDR=redis-chat:6379   # or REDIS_URL=redis://:pass@host:6379
```

| Setting | What It Does | Example |
|---------|--------------|---------|
| `SERVICE_ROLE` | `api` handles gRPC, `worker` drains streams | `api` or `worker` |
| `MONGO_URI` | DocumentDB / Mongo connection string | `mongodb://mongo-chat:27017` or `mongodb+srv://...` |
| `CHAT_REDIS_ADDR` / `REDIS_URL` | Redis endpoint (`host:port` or `redis(s)://` URL with optional `rediss://` TLS + `@` creds) | `redis-chat:6379` or `rediss://:pass@host:6379` |

`REDIS_URL` wins over `CHAT_REDIS_ADDR` if both are set. `rediss://` forces `REDIS_TLS_ENABLED=true` and password is extracted from the URL if `REDIS_PASSWORD` is empty. In `prod` these values come from `detectai/redis/chat/urls`; in `dev` they default to `redis-chat:6379`.

## Optional Configuration

### Network

```bash
GRPC_PORT=:50051              # default :50051
METRICS_PORT=:9091            # api :9091, worker :9099 (via compose WORKER_METRICS_PORT)
```

### Database Settings

```bash
MONGO_DATABASE=chat_db
MONGO_MODE=standalone          # or 'sharded' (elastic)
MONGO_TLS_ENABLED=false
MONGO_TLS_CA_FILE=
MONGO_MAX_POOL_SIZE=100        # default 100 standalone, 20 sharded
MONGO_MIN_POOL_SIZE=10         # default 10 standalone, 5 sharded
MONGO_SERVER_SELECTION_TIMEOUT=5s  # default 5s standalone, 15s sharded
```

### Redis Settings

```bash
REDIS_PASSWORD=
REDIS_TLS_ENABLED=false        # auto-true when REDIS_URL is rediss:// or from secret REDIS_TLS_ENABLED
REDIS_TLS_CA_FILE=
REDIS_POOL_SIZE=100            # default 100, 1..500
```

### Performance Settings

```bash
BATCH_SIZE=50                  # 1..500, worker batch
STREAM_PARTITION_COUNT=16      # 1..128, hash partitions for streams
CACHE_TTL=24h
```

### Observability

```bash
LOG_LEVEL=info                 # debug,info,warn,warning,error (warn→warning normalized)
OTEL_EXPORTER_OTLP_ENDPOINT=   # http(s):// — empty disables tracing
OTEL_SERVICE_NAME=chat-service
```

### AWS Bootstrap (prod only, also used for Floci local prod)

```bash
AWS_REGION=ap-south-1
AWS_ENDPOINT_URL=              # Floci: http://host.docker.internal:4566 (adds test/test creds)
SSM_PREFIX=/detectai/chat/     # alias SSM_PARAM_PREFIX, must end with /
SSM_ENABLED=true               # 0|false disables SSM
DOCDB_URLS_SECRET_NAME=detectai/docdb/urls
REDIS_URLS_SECRET_NAME=detectai/redis/chat/urls
```

* Secrets — Terraform `infra/terraform/modules/{docdb,elasticache}` emits:
  * `detectai/docdb/urls` → `{"MONGO_URI":"mongodb://...","MONGO_DATABASE":"chat_db","MONGO_MODE":"standalone"}`
  * `detectai/redis/chat/urls` → `{"CHAT_REDIS_ADDR":"host:port","REDIS_URL":"redis(s)://...","REDIS_PASSWORD":"...","REDIS_TLS_ENABLED":"true|false"}`
* SSM — paginated `GetParametersByPath(/detectai/chat/, Recursive, WithDecryption)`; keys are uppercased with `-→_` (e.g. SSM `/detectai/chat/batch-size` → `BATCH_SIZE`). Env or already-set `cfg` wins over SSM. Disable with `SSM_ENABLED=0|false`.

## Environment Examples

### Local Development (ENV_TYPE=dev)

```bash
ENV_TYPE=dev
SERVICE_ROLE=api
MONGO_URI=mongodb://localhost:27017
CHAT_REDIS_ADDR=localhost:6379
MONGO_DATABASE=chat_db
LOG_LEVEL=debug
```

With `.env` file, `ENV_TYPE=dev` auto-loads it (or `$ENV_FILE`). Missing `MONGO_URI` / `CHAT_REDIS_ADDR` fall back to `mongodb://mongo-chat:27017` / `redis-chat:6379` via dev defaults.

### Docker Compose (dev)

`infra/compose.yml` passes canonical vars with empty defaults (`${VAR:-}`):

```yaml
ENV_TYPE: ${ENV_TYPE:-dev}
SERVICE_ROLE: api
MONGO_URI: ${MONGO_URI:-}
CHAT_REDIS_ADDR: ${CHAT_REDIS_ADDR:-}
REDIS_URL: ${REDIS_URL:-}
LOG_LEVEL: ${LOG_LEVEL:-}
AWS_REGION: ${AWS_REGION:-}
SSM_PREFIX: ${SSM_PREFIX:-}
```

Run: `docker compose -f services/chats/infra/compose.yml up -d --build` — no env file needed, dev defaults apply.

### Production (AWS — Floci or real)

```bash
ENV_TYPE=prod
SERVICE_ROLE=api
AWS_REGION=ap-south-1
# No MONGO_URI / REDIS_URL in env — pulled from Secrets Manager:
#   detectai/docdb/urls + detectai/redis/chat/urls
# Optional non-secret overrides from env or SSM /detectai/chat/:
GRPC_PORT=:50051
LOG_LEVEL=info
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector:4318
```

Floci local prod test:

```bash
ENV_TYPE=prod AWS_REGION=ap-south-1 AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
  SERVICE_ROLE=api docker compose -f services/chats/infra/compose.yml up
# Seed Floci: detectai/docdb/urls, detectai/redis/chat/urls + SSM /detectai/chat/*
```

## Configuration Validation

`internal/config/config.go:Validate()` + `provider.go:validateProdStrict()`:

| Error | Cause | Fix |
|-------|-------|-----|
| `ENV_TYPE must be dev or prod` | Invalid env type | Set `ENV_TYPE=dev` or `prod` |
| `SERVICE_ROLE must be 'api' or 'worker'` | Invalid role | Set to `api` or `worker` |
| `MONGO_URI is required` | Missing MongoDB connection | Set `MONGO_URI` (dev defaults to `mongo-chat:27017`) |
| `MONGO_URI must start with mongodb://` | Bad URI scheme | Use `mongodb://` or `mongodb+srv://` |
| `CHAT_REDIS_ADDR or REDIS_URL is required` | Missing Redis | Set `CHAT_REDIS_ADDR` or `REDIS_URL` |
| `CHAT_REDIS_ADDR must be host:port` | Bad Redis addr after scheme stripping | Use `host:6379` or `redis://host:6379` |
| `MONGO_MODE must be 'standalone' or 'sharded'` | Invalid mode | Set `standalone` or `sharded` |
| `MONGO_MAX_POOL_SIZE must be 1..500` | Pool out of range | Set between 1 and 500 |
| `MONGO_MIN_POOL_SIZE must be <= MONGO_MAX_POOL_SIZE` | Min > max | Lower min or raise max |
| `REDIS_POOL_SIZE must be <= 500` | Pool out of range | Set ≤500 |
| `BATCH_SIZE must be <= 500` | Batch out of range | Set ≤500 |
| `STREAM_PARTITION_COUNT must be <= 128` | Partitions out of range | Set ≤128 |
| `GRPC_PORT has invalid format` | Bad port | Use `:50051` or `host:50051` with 1..65535 |
| `LOG_LEVEL must be one of ...` | Bad level | Use `debug,info,warn,error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT must be http(s) URL` | Bad OTEL URL | Use `http://` or `https://` |
| `ENV_TYPE=prod requires AWS_REGION` | Missing region in prod | Set `AWS_REGION` |
| `ENV_TYPE=prod requires Mongo and Redis from AWS` | No secrets/SSM | Ensure `detectai/docdb/urls` + `detectai/redis/chat/urls` exist in Floci/AWS |
| `ENV_TYPE=prod must not use default dev Mongo URL` | Dev URL leaked to prod | Point `MONGO_URI` at DocDB (via Secrets Manager), not `mongo-chat:27017` |
| `ENV_TYPE=prod must not use default dev Redis addr` | Dev Redis leaked to prod | Point `CHAT_REDIS_ADDR` at ElastiCache (via Secrets Manager), not `redis-chat:6379` |

Failed validation → service exits `panic` in `cmd/server/main.go:28`.

## Viewing Current Configuration

The service logs `LOG_LEVEL` and gRPC health. After `logger.Init(cfg.LogLevel)` check:

```
{"level":"info","msg":"Shutting down gRPC server..."}
{"level":"info","msg":"Starting gRPC server","port":":50051"}
```

Metrics: `http://localhost:9091/metrics` (api) / `http://localhost:9099/metrics` (worker).

## Developer Workflow

The service includes a Makefile with common commands:

| Command | What It Does |
|---------|--------------|
| `make deps` | Install protoc Go plugins (`protoc-gen-go`, `protoc-gen-go-grpc`) and tidy modules |
| `make proto` | Regenerate protobuf Go code from `api/proto/chat_service.proto` |
| `make build` | Build the binary to `bin/chat-service` |
| `make run` | Run the service directly with `go run` |
| `make test` | Run all unit tests |
| `make test-coverage` | Run unit tests with coverage report |
| `make test-integration` | Run integration tests (requires Docker containers, 15-minute timeout) |
| `make test-sharded` | Run sharded cluster tests (requires 5-node test cluster) |
| `make test-ha` | Run high-availability tests |
| `make test-all` | Run all tests (unit + integration + HA) |
| `make docker-build` | Build and start the Docker Compose stack |
| `make load-test` | Run k6 load tests (options: `SCENARIO`, `VUS`, `DURATION`, `RPS`) |
| `make load-down` | Tear down the load test stack |

**Prerequisites for `make proto`:**
- `protoc` (Protocol Buffers compiler) must be installed
- Run `make deps` first to install the Go protobuf plugins

**Load test examples:**
```bash
make load-test SCENARIO=smoke VUS=1 DURATION=10s
make load-test SCENARIO=load VUS=10 DURATION=2m RPS=50
make load-test SCENARIO=stress VUS=50 DURATION=5m
```

## Troubleshooting

**Service won't start?**
- Check `SERVICE_ROLE` is `api` or `worker`.
- Verify `MONGO_URI` / `CHAT_REDIS_ADDR` — in `prod` they must come from AWS, not dev defaults.
- Look for validation errors in logs (panic at startup).

**Connection refused?**
- Ensure databases are running (`docker compose -f infra/compose.yml up mongo-chat redis-chat`).
- Check `GRPC_PORT` / `MONGO_URI` / `CHAT_REDIS_ADDR` ports.
- In `prod` with `AWS_ENDPOINT_URL=http://host.docker.internal:4566`, ensure Floci is reachable and secrets seeded.

**Messages not saving?**
- Check worker is running (`SERVICE_ROLE=worker`).
- Inspect `REDIS_PASSWORD` / `REDIS_TLS_ENABLED` — `rediss://` requires TLS.
- Look at `BATCH_SIZE` / `STREAM_PARTITION_COUNT` metrics `chat_stream_lag`.

**Prod strict failure?**
- `ENV_TYPE=prod must not use default dev ...` → remove `MONGO_URI=mongodb://mongo-chat:27017` from env/compose, rely on Secrets Manager.
- `requires Mongo and Redis from AWS` → seed `detectai/docdb/urls` and `detectai/redis/chat/urls` in Floci (`aws secretsmanager create-secret ...`) and `ssm put-parameter /detectai/chat/...`.

## Related Documentation

- [Architecture](../concepts/architecture.md) — How components connect
- [Request Flows](../concepts/request-flows.md) — How requests are processed
- [Health](../operations/health.md) — How to check if configuration is working
- [Observability](../operations/observability.md) — Monitor configuration impact
- [Gateway Configuration](../../payments/gateway/docs/08-configuration.md) — Reference AWS chain pattern
- [Workers Configuration](../../workers/docs/configuration.md) — Reference ENV_TYPE handling
