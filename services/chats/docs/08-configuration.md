# Configuration

Full reference for `internal/config/config.go` + `infra/compose*.yml` + atoms.

## Env table

| Var | Default | Range | Notes |
|---|---|---|---|
| `APP_ENV` | `production` | `string` | `logger.Init`, reflection off when `production` |
| `SERVICE_ROLE` | *(required)* | `api/worker` | lowercased/trimmed; `api`=gRPC server, `worker`=consumer |
| `GRPC_PORT` | `:50051` | `:port` / `host:port` | `net.Listen` in `grpc/server.go:34` |
| `METRICS_PORT` | `:9091` (`:9099` worker) | `:port` | `StartMetricsServer` `/metrics` + `/healthz` |
| `MONGO_URI` | *(required)* | `mongodb://...` | `database.ConnectMongo`, default `mongodb://chat-mongo:27017` in compose |
| `MONGO_DATABASE` | `chat_db` | `string` | `chats` + `messages` collections |
| `CHAT_REDIS_MODE` | `cluster` | `standalone/cluster` | `standalone` pins to first addr |
| `CHAT_REDIS_ADDRS` | *(required)* | `host:port[,..]` | default `chat-redis:6379` in compose |
| `REDIS_PASSWORD` | *(empty / `test_redis_password` load)* | `string` | `UniversalClient` + `redis-cli -a` healthcheck; chat-redis atom defaults for local |
| `REDIS_POOL_SIZE` | `100` | `1..500` | `<=0→100`, `>500` error |
| `BATCH_SIZE` | `50` | `1..500` | consumer `XReadGroup Count`; `<=0→50` |
| `STREAM_PARTITION_COUNT` | `16` | `1..128` | streams + worker goroutines; `<=0→16` |
| `CACHE_TTL` | `24h` | `>0` | `NewCacheRepository`, `<=0→24h` |
| `CHAT_MONGO_PORT` | `27018` | `port` | compose publish `27018:27017` |
| `CHAT_REDIS_PORT` | `6381` | `port` | compose publish `6381:6379` |
| `CHAT_GRPC_HOST_PORT` | `50052` | `port` | compose publish |
| `CHAT_METRICS_HOST_PORT` | `9095` | `port` | compose publish |
| `CHAT_WORKER_METRICS_PORT_HOST` | `9099` | `port` | compose publish |

## Validation

```go
// config.go:40
require MONGO_URI, CHAT_REDIS_ADDRS non-empty
require SERVICE_ROLE api|worker (normalized)
CHAT_REDIS_MODE in {standalone, cluster}
REDIS_POOL_SIZE 1..500, BATCH_SIZE 1..500, STREAM_PARTITION_COUNT 1..128
CACHE_TTL >0 else 24h; GRPC/METRICS_PORT ":port" or "host:port"
```

`ENV_FILE` (optional) loads `godotenv` before `envconfig.Process`. Failed validation → `panic` in `main.go:25` (fail fast, no serving).

## Compose

* `infra/compose.yml` (`name: chats`) — `include: chat-mongo + chat-redis` atoms, publishes `27018/6381/50052/9095/9099`, `MONGO_URI=mongodb://chat-mongo:27017`, `CHAT_REDIS_ADDRS=chat-redis:6379`, `depends_on` healthy datastores.
* `infra/compose.load.yml` (`name: chats-load`) — same atoms internal-only on `chat_loadnet` (no host ports), `REDIS_PASSWORD=test_redis_password` default, `+k6` (`CHAT_SERVICE_ADDR=chat-service:50051`, `PROTO_DIR=/proto`).
* `infra/docker/chat-mongo/standalone.yml` — `mongo:6.0`, `mongod --bind_ip_all`, `chat_mongo_data:/data/db`, no `networks/container_name`.
* `infra/docker/chat-redis/standalone.yml` — `redis:7-alpine --appendonly yes --requirepass`, `chat_redis_data:/data`.

See `../README.md` for quickstart (repo root) and `09-api.md` for RPC limits.
