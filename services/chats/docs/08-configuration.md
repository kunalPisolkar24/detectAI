# Configuration

Full reference for `internal/config/config.go` + `infra/compose*.yml` + atoms.

## Env table

| Var | Default | Range | Notes |
|---|---|---|---|
| `APP_ENV` | `production` | `string` | `logger.Init`, reflection off when `production` |
| `SERVICE_ROLE` | *(required)* | `api/worker` | lowercased/trimmed; `api`=gRPC server, `worker`=consumer |
| `GRPC_PORT` | `:50051` | `:port` / `host:port` | `net.Listen` in `grpc/server.go:34` |
| `METRICS_PORT` | `:9091` (`:9099` worker) | `:port` | `StartMetricsServer` `/metrics` + `/healthz` |
| `MONGO_URI` | *(required)* | `mongodb://...` | `database.ConnectMongo`, default `mongodb://mongo-chat:27017` standalone, `mongodb://mongos:27017/?retryWrites=false` sharded. `retryWrites=false` required for DocumentDB/elastic and safe on standalone. |
| `MONGO_DATABASE` | `chat_db` | `string` | `chats` + `messages` collections |
| `MONGO_MODE` | `standalone` | `standalone/sharded` | `standalone`=single mongod/DocumentDB instance, `sharded`=mongos/elastic. Gates `EnsureSharding(messages on chat_id:hashed)` + pool/tls defaults. |
| `MONGO_TLS_ENABLED` | `false` | `bool` | `true` for DocumentDB TLS (read `MONGO_TLS_CA_FILE` if set) |
| `MONGO_TLS_CA_FILE` | *(empty)* | `path` | CA bundle (e.g. `rds-combined-ca-bundle.pem`). When empty + TLS=true, `InsecureSkipVerify` (Floci local). Real AWS always provide bundle. |
| `MONGO_MAX_POOL_SIZE` | `100` standalone / `20` sharded | `1..500` | `MaxPoolSize` for `mongo.Client` |
| `MONGO_MIN_POOL_SIZE` | `10` standalone / `5` sharded | `0..max` | `MinPoolSize` |
| `MONGO_SERVER_SELECTION_TIMEOUT` | `5s` standalone / `15s` sharded | `duration` | Router failover needs larger timeout when sharded |
| `CHAT_REDIS_MODE` | `standalone` | `standalone/cluster` | `standalone` pins to first addr (ElastiCache replication group, 1+1 primary-for-all) |
| `CHAT_REDIS_ADDRS` | *(required)* | `host:port[,..]` | default `redis-chat:6379` in compose; Floci `localhost:6380` auto-translated to bridge backend `172.17.0.5:6379` when `FLOCI_ENDPOINT` set (proxy HELLO bug workaround) |
| `REDIS_CHAT_PASSWORD` | *(empty / `test_redis_password` load)* | `string` | `UniversalClient` + `redis-cli -a` healthcheck; redis-chat atom defaults for local; ElastiCache `auth_token` via `REDIS_PASSWORD` |
| `REDIS_TLS_ENABLED` | `false` | `bool` | `true` for ElastiCache `rediss://` (prod) |
| `REDIS_TLS_CA_FILE` | *(empty)* | `path` | CA bundle when `REDIS_TLS_ENABLED` |
| `REDIS_POOL_SIZE` | `100` | `1..500` | `<=0→100`, `>500` error |
| `FLOCI_ENDPOINT` | *(empty)* | `url` | `http://localhost:4566` for Floci; when set, `localhost:6380` Redis is translated to bridge backend to bypass proxy HELLO issue; real AWS ElastiCache handles HELLO correctly so no translation |
| `BATCH_SIZE` | `50` | `1..500` | consumer `XReadGroup Count`; `<=0→50` |
| `STREAM_PARTITION_COUNT` | `16` | `1..128` | streams + worker goroutines; `<=0→16` |
| `CACHE_TTL` | `24h` | `>0` | `NewCacheRepository`, `<=0→24h` |
| `MONGO_CHAT_PORT` | `27018` | `port` | compose publish `27018:27017` |
| `REDIS_CHAT_PORT` | `6381` | `port` | compose publish `6381:6379` |
| `CHAT_GRPC_HOST_PORT` | `50052` | `port` | compose publish |
| `CHAT_METRICS_HOST_PORT` | `9095` | `port` | compose publish |
| `CHAT_WORKER_METRICS_PORT_HOST` | `9099` | `port` | compose publish |

## Validation

```go
// config.go:40
require MONGO_URI, CHAT_REDIS_ADDRS non-empty
require SERVICE_ROLE api|worker (normalized)
CHAT_REDIS_MODE in {standalone, cluster}
MONGO_MODE in {standalone, sharded}
MONGO_TLS_CA_FILE must be readable when MONGO_TLS_ENABLED + set
REDIS_TLS_CA_FILE must be readable when REDIS_TLS_ENABLED + set
REDIS_POOL_SIZE 1..500, BATCH_SIZE 1..500, STREAM_PARTITION_COUNT 1..128
MONGO_MAX_POOL_SIZE 1..500, MONGO_MIN_POOL_SIZE <= max, MONGO_SERVER_SELECTION_TIMEOUT >0
CACHE_TTL >0 else 24h; GRPC/METRICS_PORT ":port" or "host:port"
```

`ENV_FILE` (optional) loads `godotenv` before `envconfig.Process`. Failed validation → `panic` in `main.go:25` (fail fast, no serving).

## Compose

* `infra/compose.yml` (`name: chats`) — `include: mongo-chat + redis-chat` atoms, publishes `27018/6381/50052/9095/9099`, `MONGO_URI=mongodb://mongo-chat:27017`, `CHAT_REDIS_ADDRS=redis-chat:6379`, `depends_on` healthy datastores, `MONGO_MODE=standalone` default. For sharded DocumentDB/elastic (`MONGO_MODE=sharded`, `messages` on `chat_id:hashed`, `chats` stays unsharded) use the same compose with an external `MONGO_URI` (e.g. DocumentDB endpoint via Terraform `detectai/docdb` secret); queries stay targeted on `chat_id` so no compose change is needed.
* `infra/compose.load.yml` (`name: chats-load`) — same atoms internal-only on `chat_loadnet` (no host ports), `REDIS_CHAT_PASSWORD=test_redis_password` default, `+k6` (`CHAT_SERVICE_ADDR=chat-service:50051`, `PROTO_DIR=/proto`).
* `infra/docker/mongo-chat/standalone.yml` — `mongo:6.0`, `mongod --bind_ip_all`, `mongo_chat_data:/data/db`, no `networks/container_name`.
* `infra/docker/redis-chat/standalone.yml` — `redis:7-alpine --appendonly yes --requirepass`, `redis_chat_data:/data`.

Sharding verification (now removed from compose) was done via a throwaway `mongos+2 shards+configsvr` stack (`enableSharding` + `shardCollection(messages,{chat_id:hashed})`); permanent sharding tests use Floci DocumentDB (`infra/terraform/modules/docdb`, `MONGO_URI` with `authSource=admin&retryWrites=false`).

See `../README.md` for quickstart (repo root) and `09-api.md` for RPC limits.
