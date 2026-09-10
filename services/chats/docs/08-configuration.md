# Configuration

All config comes from env (`internal/config/config.go`). Fail-fast on invalid values.

```ini
# required
SERVICE_ROLE=api                  # api | worker
MONGO_URI=mongodb://mongo-chat:27017
CHAT_REDIS_ADDR=redis-chat:6379   # host:port

# optional
MONGO_DATABASE=chat_db
MONGO_MODE=standalone             # standalone | sharded
MONGO_TLS_ENABLED=false
MONGO_TLS_CA_FILE=
MONGO_MAX_POOL_SIZE=100           # 20 when sharded
MONGO_MIN_POOL_SIZE=10            # 5 when sharded
MONGO_SERVER_SELECTION_TIMEOUT=5s # 15s when sharded
REDIS_PASSWORD=
REDIS_TLS_ENABLED=false
REDIS_TLS_CA_FILE=
REDIS_POOL_SIZE=100
BATCH_SIZE=50
STREAM_PARTITION_COUNT=16
CACHE_TTL=24h
GRPC_PORT=:50051
METRICS_PORT=:9091                # :9099 for worker
```

**What each does**

- `SERVICE_ROLE` — run as gRPC api or stream worker
- `MONGO_URI` — mongo connection string
- `CHAT_REDIS_ADDR` — redis primary `host:port` (compose `redis-chat:6379`, Floci `localhost:6380`, AWS DNS)
- `MONGO_DATABASE` — db name for `chats` and `messages`
- `MONGO_MODE` — `standalone` (single mongod) or `sharded` (mongos/elastic, shards `messages` on `chat_id:hashed`)
- `MONGO_TLS_ENABLED` / `MONGO_TLS_CA_FILE` — enable TLS for DocumentDB
- `MONGO_MAX_POOL_SIZE` / `MONGO_MIN_POOL_SIZE` / `MONGO_SERVER_SELECTION_TIMEOUT` — mongo driver pool and timeout
- `REDIS_PASSWORD` — redis auth token (`REDIS_CHAT_PASSWORD` in compose)
- `REDIS_TLS_ENABLED` / `REDIS_TLS_CA_FILE` — enable TLS for ElastiCache `rediss://`
- `REDIS_POOL_SIZE` — redis connection pool size
- `BATCH_SIZE` — worker `XReadGroup` count
- `STREAM_PARTITION_COUNT` — number of streams and worker goroutines
- `CACHE_TTL` — hot cache expiry
- `GRPC_PORT` / `METRICS_PORT` — listen addresses
