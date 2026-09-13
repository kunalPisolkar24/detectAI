# Infrastructure

This document explains the infrastructure components that the Web service depends on: PostgreSQL, Redis, RabbitMQ, analytics publishing, rate limiting, and distributed tracing.

## Overview

```mermaid
graph TB
    subgraph "Web Service"
        App[Next.js App]
        RateLimit[Rate Limiter]
        Analytics[Analytics Publisher]
        Cache[Cache Service]
    end

    subgraph "Data Stores"
        PG[(PostgreSQL<br/>Prisma ORM)]
        Redis[(Redis<br/>ioredis)]
        RabbitMQ[RabbitMQ<br/>amqplib)]
    end

    subgraph "Observability"
        Logger[Pino Logger]
        Metrics[Prometheus Metrics]
        Tracing[OpenTelemetry]
    end

    App --> PG
    App --> Redis
    App --> RabbitMQ
    RateLimit --> Redis
    RateLimit --> PG
    Analytics --> RabbitMQ
    Cache --> Redis
    App --> Logger
    App --> Metrics
    App --> Tracing
```

## PostgreSQL (Prisma ORM)

**What it does:** Stores user data, sessions, subscriptions, and usage records.

### Connection

```typescript
// lib/infrastructure/prisma.ts
import { PrismaClient } from "@prisma/client"

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: env.DATABASE_URL,
    },
  },
})
```

### Configuration

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/detect_ai
DATABASE_URL_REPLICA=                           # Optional read replica
DB_POOL_MAX=5                                   # Connection pool size (1-50)
```

### Schema Models

| Model | Purpose |
|-------|---------|
| `User` | User accounts and profiles |
| `Session` | Active sessions (if using DB sessions) |
| `Account` | OAuth provider links |
| `Usage` | API usage tracking for rate limiting |
| `Subscription` | Paddle subscription data |

### Health Check

The readiness probe (`/api/readyz`) checks PostgreSQL with:

```sql
SELECT 1
```

## Redis (ioredis)

**What it does:** Caches data, tracks rate limits, and provides fast key-value operations.

### Connection

```typescript
// lib/infrastructure/redis.ts
import Redis from "ioredis"

export const redis = new Redis(env.REDIS_URL)
```

### Configuration

```bash
REDIS_URL=redis://:password@localhost:6379      # redis:// or rediss:// for TLS
REDIS_PASSWORD=                                  # Optional, extracted from URL
```

### Key Patterns

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `usage:daily:{userId}:{date}` | Daily API usage counter | Resets at midnight UTC |

### Health Check

The readiness probe checks Redis with:

```
PING
```

Expected response: `PONG`

## Rate Limiting

**What it does:** Limits API usage to prevent abuse. Free tier users get 100 requests per day.

### How It Works

```mermaid
sequenceDiagram
    participant User as User Request
    participant Redis as Redis
    participant DB as PostgreSQL
    participant Queue as RabbitMQ

    User->>Redis: GET usage key
    alt Redis available
        Redis-->>User: Current count
    else Redis unavailable
        User->>DB: Fallback query
        DB-->>User: Current count
    end

    alt Under limit
        User-->>User: Allow request
        User->>Redis: INCR usage key
        User->>Queue: Publish usage event
    else Over limit
        User-->>User: 429 Rate Limit Exceeded
    end
```

### Implementation

Located at `lib/application/rate-limit.ts`:

```typescript
export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100

  async checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
    if (isPremium) return { allowed: true, remaining: -1 }

    const key = this.getDailyKey(userId)
    const usage = await usageRedis.get(key)
    const currentUsage = parseInt(usage ?? "0", 10)
    const allowed = currentUsage < RedisRateLimitService.FREE_TIER_LIMIT

    return { allowed, remaining: Math.max(0, FREE_TIER_LIMIT - currentUsage) }
  }
}
```

### Usage Tracking

When a request is counted:

1. **Redis INCR** — Atomically increments the daily counter
2. **RabbitMQ publish** — Sends usage event for billing
3. **DB fallback** — If both fail, writes directly to PostgreSQL

### Lua Script for Atomicity

```lua
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return current
```

This ensures the increment and expiry are atomic.

## Analytics Publishing (RabbitMQ)

**What it does:** Publishes usage events to RabbitMQ for billing and analytics processing.

### Queue Configuration

| Property | Value |
|----------|-------|
| Queue name | `analytics.usage` |
| Queue type | `quorum` (durable, replicated) |
| Dead letter exchange | `analytics.usage_dlx` |
| Content type | `application/json` |

### Event Format

```typescript
interface UsageEvent {
  event_type: "usage_event"
  eventId: string          // UUID for idempotency
  userId: string           // User who made the request
  count: number            // Number of API calls
  timestamp: string        // ISO 8601 timestamp
}
```

### Publishing Flow

```mermaid
sequenceDiagram
    participant Web as Web Service
    participant MQ as RabbitMQ
    participant Worker as Analytics Worker

    Web->>MQ: Publish usage event
    MQ-->>Web: Acknowledged
    MQ->>Worker: Deliver event
    Worker->>Worker: Process for billing
```

### Error Handling

| Error | Handling |
|-------|----------|
| Connection failure | Retry once, then throw `AnalyticsPublishError` |
| Channel closed | Reconnect and retry |
| Buffer full (backpressure) | Treat as failure, caller decides fallback |
| Queue mismatch (406) | Throw with diagnostic message |

### Fallback: Direct DB Write

If both Redis and RabbitMQ are unavailable, usage is written directly to PostgreSQL:

```sql
INSERT INTO "Usage" ("id", "userId", "apiCallCountTotal", "apiCallCountDaily", "lastApiCallReset", "updatedAt", "createdAt")
VALUES (gen_random_uuid(), $1, $2, $2, NOW(), NOW(), NOW())
ON CONFLICT ("userId") DO UPDATE SET ...
```

## Caching

**What it does:** Provides fast access to frequently used data.

### Cache Service

Located at `lib/services/cache-service.ts`:

```typescript
export class CacheService {
  async get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key)
    return raw ? JSON.parse(raw) : null
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds)
  }
}
```

### Cache Keys

Defined in `lib/services/cache-keys.ts`:

| Pattern | Purpose |
|---------|---------|
| `usage:daily:{userId}:{date}` | Daily usage counter |

## Distributed Locking

**What it does:** Prevents concurrent operations on the same resource.

### Lock Service

Located at `lib/services/lock-service.ts`:

```typescript
export class LockService {
  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const result = await redis.set(`lock:${key}`, "1", "PX", ttlMs, "NX")
    return result === "OK"
  }

  async release(key: string): Promise<void> {
    await redis.del(`lock:${key}`)
  }
}
```

## OpenTelemetry Tracing

**What it does:** Provides distributed tracing across services.

### Configuration

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector:4318   # Empty disables tracing
OTEL_SERVICE_NAME=web                                       # Service name in traces
```

### How It Works

```mermaid
graph LR
    Request[Incoming Request] --> Span[Create Span]
    Span --> gRPC[gRPC Calls]
    Span --> DB[Database Queries]
    Span --> Cache[Cache Operations]
    Span --> Export[Export to Collector]
```

### Implementation

Located at `lib/infrastructure/tracing.ts`:

- Uses `@opentelemetry/sdk-node` for SDK setup
- Uses `@opentelemetry/auto-instrumentations-node` for automatic instrumentation
- Disables fs, DNS, and net instrumentations (noisy, low value)
- Injects trace context into logs via `logger.mixin()`

### Trace Context in Logs

Every log entry includes `traceId` and `spanId` when tracing is active:

```json
{
  "level": "info",
  "msg": "AI analysis completed",
  "traceId": "abc123...",
  "spanId": "def456..."
}
```

## Graceful Shutdown

**What it does:** Ensures clean shutdown when the process receives SIGTERM/SIGINT.

### Shutdown Sequence

```mermaid
graph TB
    Signal[SIGTERM/SIGINT] --> Log[Log shutdown signal]
    Log --> Tracing[Shutdown OTEL tracing]
    Tracing --> Prisma[Disconnect Prisma]
    Prisma --> Redis[Quit Redis]
    Redis --> Exit[Exit after 500ms]
```

### Implementation

Located at `lib/infrastructure/shutdown.ts`:

```typescript
process.once("SIGTERM", () => void shutdown("SIGTERM"))
process.once("SIGINT", () => void shutdown("SIGINT"))

process.on("unhandledRejection", (reason) => { ... })
process.on("uncaughtException", (err) => { ... })
```

### What Gets Cleaned Up

1. OpenTelemetry tracing (flushes remaining spans)
2. Prisma client (disconnects from PostgreSQL)
3. Redis client (closes connection)
4. Process exits after 500ms grace period

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DATABASE_URL_REPLICA` | — | Read replica URL (optional) |
| `DB_POOL_MAX` | `5` | Max PostgreSQL connections |
| `REDIS_URL` | — | Redis connection string |
| `REDIS_PASSWORD` | — | Redis password (optional if in URL) |
| `RABBITMQ_URL` | — | RabbitMQ connection string |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTEL collector URL (empty = disabled) |
| `OTEL_SERVICE_NAME` | `web` | Service name in traces |

## Troubleshooting

### PostgreSQL connection refused

- Ensure PostgreSQL is running
- Check `DATABASE_URL` format and credentials
- Verify `DB_POOL_MAX` is within limits

### Redis connection refused

- Ensure Redis is running
- Check `REDIS_URL` format
- Verify Redis password if using ACL

### RabbitMQ connection refused

- Ensure RabbitMQ is running
- Check `RABBITMQ_URL` format
- Verify queue exists and is accessible

### Rate limiting not working

- Check Redis connectivity
- Look at `usage_redis_errors_total` metric
- Verify cache key format

### Tracing not appearing

- Check `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
- Verify collector is running and accessible
- Look at logs for "OTEL tracing disabled" message

## Related Documentation

- [Configuration](../getting-started/configuration.md) - Infrastructure settings
- [Observability](../operations/observability.md) - Metrics and monitoring
- [Health Checks](../operations/health.md) - Infrastructure health probes
