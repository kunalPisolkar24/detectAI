# Configuration

This document explains how to configure the Chats service for your environment.

## How Configuration Works

The service reads configuration from **environment variables**. This is a common pattern that makes it easy to configure the same code for different environments (development, testing, production).

## Required Configuration

These settings are **mandatory** - the service won't start without them:

```bash
# What mode to run in
SERVICE_ROLE=api          # or 'worker'

# Database connection
MONGO_URI=mongodb://mongo-chat:27017

# Cache connection
CHAT_REDIS_ADDR=redis-chat:6379
```

### What Each Required Setting Does

| Setting | What It Does | Example |
|---------|--------------|---------|
| `SERVICE_ROLE` | Determines if this instance handles API requests or processes messages | `api` or `worker` |
| `MONGO_URI` | Connection string for MongoDB | `mongodb://localhost:27017` |
| `CHAT_REDIS_ADDR` | Connection string for Redis | `localhost:6379` |

## Optional Configuration

These settings have sensible defaults but can be customized:

### Database Settings

```bash
# Database name (default: chat_db)
MONGO_DATABASE=chat_db

# Operation mode (default: standalone)
MONGO_MODE=standalone      # or 'sharded'

# TLS settings (for production databases)
MONGO_TLS_ENABLED=false
MONGO_TLS_CA_FILE=

# Connection pool (default: 20 min, 100 max)
MONGO_MIN_POOL_SIZE=10
MONGO_MAX_POOL_SIZE=100

# Timeout settings
MONGO_SERVER_SELECTION_TIMEOUT=5s
```

**When to change these:**
- `MONGO_MODE=sharded` - Use when connecting to a sharded MongoDB cluster
- `MONGO_TLS_ENABLED=true` - Use when connecting to a database that requires TLS
- Pool sizes - Increase for high-traffic deployments

### Redis Settings

```bash
# Redis authentication
REDIS_PASSWORD=

# TLS settings (for production Redis)
REDIS_TLS_ENABLED=false
REDIS_TLS_CA_FILE=

# Connection pool (default: 100)
REDIS_POOL_SIZE=100
```

### Performance Settings

```bash
# How many messages to process at once (default: 50)
BATCH_SIZE=50

# How many stream partitions (default: 16)
STREAM_PARTITION_COUNT=16

# How long to keep cached messages (default: 24 hours)
CACHE_TTL=24h
```

**When to change these:**
- `BATCH_SIZE` - Increase for higher throughput (uses more memory)
- `STREAM_PARTITION_COUNT` - Increase for better parallelism
- `CACHE_TTL` - Increase if you want cache to last longer

### Network Settings

```bash
# gRPC API port (default: :50051)
GRPC_PORT=:50051

# Metrics port (default: :9091 for API, :9099 for worker)
METRICS_PORT=:9091
```

## Environment Examples

### Local Development

```bash
# .env file for local development
SERVICE_ROLE=api
MONGO_URI=mongodb://localhost:27017
CHAT_REDIS_ADDR=localhost:6379
MONGO_DATABASE=chat_db
```

### Docker Compose

```bash
# In docker-compose.yml
SERVICE_ROLE=api
MONGO_URI=mongodb://mongo-chat:27017
CHAT_REDIS_ADDR=redis-chat:6379
```

### Production (AWS)

```bash
# Production settings
SERVICE_ROLE=api
MONGO_URI=mongodb://docdb-cluster.cluster-xxxx.us-east-1.docdb.amazonaws.com:27017
CHAT_REDIS_ADDR=redis-cluster.xxxx.use1.cache.amazonaws.com:6379
MONGO_TLS_ENABLED=true
REDIS_TLS_ENABLED=true
MONGO_MAX_POOL_SIZE=200
REDIS_POOL_SIZE=200
```

## Configuration Validation

The service validates configuration on startup:

| Error | Cause | Fix |
|-------|-------|-----|
| `SERVICE_ROLE must be 'api' or 'worker'` | Invalid role | Set to `api` or `worker` |
| `MONGO_URI is required` | Missing MongoDB connection | Set `MONGO_URI` |
| `CHAT_REDIS_ADDR is required` | Missing Redis connection | Set `CHAT_REDIS_ADDR` |
| `Invalid pool size` | Pool size out of range | Set between 1 and 500 |

## Viewing Current Configuration

The service logs its configuration at startup. Check the logs for:

```
{"level":"info","msg":"Configuration loaded","service_role":"api","mongo_uri":"..."}
```

## Troubleshooting

**Service won't start?**
- Check that all required variables are set
- Verify database connection strings are correct
- Look for validation errors in logs

**Connection refused?**
- Ensure databases are running
- Check network connectivity
- Verify ports are correct

**Performance issues?**
- Check pool sizes (too low = connection contention)
- Verify timeouts are appropriate
- Monitor connection usage

## Related Documentation

- [Architecture](01-architecture.md) - How components connect
- [Health](07-health.md) - How to check if configuration is working
- [Observability](10-observability.md) - Monitor configuration impact
