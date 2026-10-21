# Infrastructure

This document explains the infrastructure components that the Web service depends on: PostgreSQL, Redis, RabbitMQ, analytics publishing, caching, locking, and distributed tracing.

## Overview

```mermaid
graph TB
    subgraph "Web Service"
        App[Next.js App]
        RateLimit[Rate Limiter]
        Analytics[Analytics Publisher]
        Cache[Cache Service]
        Lock[Lock Service]
    end

    subgraph "Data Stores"
        PG[(PostgreSQL<br/>Prisma ORM)]
        Redis[(Redis<br/>ioredis)]
        RabbitMQ[(RabbitMQ<br/>amqplib)]
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
    RateLimit --> RabbitMQ
    Analytics --> RabbitMQ
    Cache --> Redis
    Lock --> Redis
    App --> Logger
    App --> Metrics
    App --> Tracing
```

## PostgreSQL (Prisma ORM)

**What it does:** Stores user data, subscriptions, and usage records.

### Connection

The Prisma client is generated into the app rather than taken from the `@prisma/client` package, and it connects through a **driver adapter** instead of Prisma's own connection handling:

```typescript
// lib/infrastructure/prisma.ts
import { PrismaClient } from '../shared/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const poolPrimary = new Pool({ connectionString: primaryUrl, ...poolConfig })
const poolReplica = replicaUrl === primaryUrl ? poolPrimary : new Pool({ connectionString: replicaUrl, ...poolConfig })

const adapterPrimary = new PrismaPg(poolPrimary);
const adapterReplica = new PrismaPg(poolReplica);

const prismaPrimary = new PrismaClient({ adapter: adapterPrimary });
const prismaReplica = new PrismaClient({ adapter: adapterReplica });
```

**Two clients, one primary and one replica.** The client is extended with a query interceptor that sends reads to the replica and writes to the primary:

```typescript
const READ_OPERATIONS = [
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
]
```

The interceptor also times every query and records it in the `db_query_duration_seconds` metric.

**Pool configuration:**

| Setting | Value |
|---------|-------|
| `max` | `DB_POOL_MAX` (default 5) |
| `idleTimeoutMillis` | 30 000 |
| `connectionTimeoutMillis` | 10 000 |
| `options` | `-c statement_timeout=30000` |
| `ssl` | Enabled when the URL contains `sslmode=require` or `sslmode=verify` |

**In preview mode** the client is replaced by a proxy that throws on every call, so a mistake in preview mode fails loudly instead of quietly writing to a mock database.

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
| `Session` | Active sessions (unused — the app uses JWT sessions) |
| `Account` | OAuth provider links |
| `Usage` | API usage tracking for rate limiting |
| `Subscription` | Paddle subscription data |
| `VerificationToken` | Standard NextAuth model, unused by the app |
| `ProcessedWebhook` | Idempotent webhook event tracking |

### Database Schema

#### Full ER Diagram

```mermaid
erDiagram
    User ||--o| Subscription : "has one"
    User ||--o| Usage : "has one"
    User ||--o{ Account : "has many"
    User ||--o{ Session : "has many"

    User {
        string id PK
        string email UK
        string name
        string firstName
        string lastName
        string password
        string image
        datetime emailVerified
        string paddleCustomerId UK
        datetime createdAt
        datetime updatedAt
    }

    Subscription {
        string id PK
        string userId FK "unique"
        string paddleSubscriptionId UK
        string paddlePlanId
        enum status
        datetime endsAt
        boolean cancellationScheduled
        datetime eventTimestamp
        datetime createdAt
        datetime updatedAt
    }

    Usage {
        string id PK
        string userId FK "unique"
        int apiCallCountDaily
        int apiCallCountTotal
        datetime lastApiCallReset
        datetime createdAt
        datetime updatedAt
    }

    Account {
        string id PK
        string userId FK
        string provider
        string providerAccountId
        string type
        text refresh_token
        text access_token
        int expires_at
        string token_type
        string scope
        text id_token
        string session_state
    }

    Session {
        string id PK
        string sessionToken UK
        string userId FK
        datetime expires
    }

    VerificationToken {
        string identifier
        string token UK
        datetime expires
    }

    ProcessedWebhook {
        string eventId PK
        string eventType
        datetime receivedAt
    }
```

#### User & Authentication

How users log in. Accounts link to OAuth providers (Google, GitHub). Sessions track active logins.

```mermaid
erDiagram
    User ||--o{ Account : "OAuth providers"
    User ||--o{ Session : "active sessions"

    User {
        string id PK
        string email UK
        string name
        string password
    }

    Account {
        string id PK
        string userId FK
        string provider
        string providerAccountId
        text access_token
    }

    Session {
        string id PK
        string sessionToken UK
        string userId FK
        datetime expires
    }
```

**There is no email-verification flow.** `VerificationToken` exists in the schema as a standard NextAuth model, but it has no foreign key to `User` and nothing in the app reads or writes it. The `User.emailVerified` column exists too, but it is never set.

#### Subscription & Billing

Links a user to their Paddle subscription. The `Usage` model tracks daily and total API calls for rate limiting (free tier: 100 calls/day).

```mermaid
erDiagram
    User ||--o| Subscription : "Paddle billing"
    User ||--o| Usage : "rate limiting"

    User {
        string id PK
        string email UK
        string paddleCustomerId UK
    }

    Subscription {
        string id PK
        string userId FK "unique"
        string paddleSubscriptionId UK
        string paddlePlanId
        enum status
        datetime endsAt
    }

    Usage {
        string id PK
        string userId FK "unique"
        int apiCallCountDaily
        int apiCallCountTotal
        datetime lastApiCallReset
    }
```

#### Webhook Event Tracking

`ProcessedWebhook` stores event IDs from Paddle to prevent duplicate processing. It stands alone (no foreign key to User).

```mermaid
erDiagram
    ProcessedWebhook {
        string eventId PK
        string eventType
        datetime receivedAt
    }
```

### Relationships

| Parent | Child | Type | FK Column | On Delete |
|--------|-------|------|-----------|-----------|
| User | Subscription | 1:1 | `userId` | Cascade |
| User | Usage | 1:1 | `userId` | Cascade |
| User | Account | 1:N | `userId` | Cascade |
| User | Session | 1:N | `userId` | Cascade |

### Health Check

The readiness probe (`/api/readyz`) checks PostgreSQL with:

```sql
SELECT 1
```

It opens its own short-lived pool for the check, so the probe does not compete with the application's pool.

## Redis (ioredis)

**What it does:** Caches data, tracks rate limits, and provides fast key-value operations.

### Connection

```typescript
// lib/infrastructure/redis.ts
const { url, options } = getStandaloneConfig()
const client = new Redis(url, options)
```

The client is configured to fail fast rather than queue requests forever:

| Option | Value | Why |
|--------|-------|-----|
| `password` | `REDIS_PASSWORD` | Extracted from the URL when not set separately |
| `retryStrategy` | Up to 3 attempts, then stop | Fail fast so callers can degrade to database-only mode |
| `maxRetriesPerRequest` | 2 | Same |
| `enableOfflineQueue` | `false` | Do not queue commands while disconnected |
| `family` | 4 | IPv4 only, which is what the container network uses |
| `keepAlive` | 10 000 | Keepalive interval in milliseconds |
| `lazyConnect` | `true` | Connect on first command |

**In preview mode** the client is replaced by a proxy whose methods return `null`, so nothing actually talks to Redis.

### Configuration

```bash
REDIS_URL=redis://:password@localhost:6379      # redis:// or rediss:// for TLS
REDIS_PASSWORD=                                  # Optional, extracted from URL
```

### Key Patterns

The keys are defined in `lib/domain/cache-keys.ts`, and re-exported from `lib/services/cache-keys.ts` for callers that import from there.

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `user:basic:{id}` | Cached user record | 1 hour |
| `user:basic:email:{hash}` | Cached user record, keyed by a hashed email | 1 hour |
| `user:sub:{id}` | Cached user subject | 10 minutes |
| `rate_limit:{userId}:daily:{utcDay}` | Daily usage counter | Until midnight UTC |
| `abuse:{scope}:{identifierHash}:{windowId}` | Abuse-limiter window counter | Until the window ends |
| `analytics:usage:event:{eventId}` | Deduplication key for usage events | 7 days |
| `lock:{resource}` | Distributed lock | Set by the caller |

**Emails are hashed before they become keys**, so a raw address never lands in Redis.

### Health Check

The readiness probe checks Redis with:

```
PING
```

Expected response: `PONG`

## Rate Limiting

**What it does:** Limits API usage to prevent abuse. The service has two limiters — a daily cap for free users and an abuse limiter for bursts. See [Rate Limiting](rate-limiting.md) for the full picture.

### Daily Cap

Located at `lib/application/rate-limit.ts`:

```typescript
export class RedisRateLimitService implements IRateLimitService {
  private static readonly FREE_TIER_LIMIT = 100

  public async checkLimit(userId: string, isPremium: boolean): Promise<{ allowed: boolean; remaining: number }> {
    if (isPremium) {
      return { allowed: true, remaining: -1 }
    }

    try {
      const key = this.getDailyKey(userId)
      const usage = await usageRedis.get(key)
      const currentUsage = this.parseCounter(usage, userId, "get")
      const allowed = currentUsage < RedisRateLimitService.FREE_TIER_LIMIT
      // ...
    } catch (error) {
      try { metrics.usageRedisErrors.inc({ operation: "get" }) } catch {}
      logger.error({ msg: "Rate limit check failed, falling back to DB", userId, error })
      return this.checkLimitFromDB(userId)
    }
  }
}
```

### Usage Tracking

When a request is counted:

1. **Redis increment** — atomically increments the daily counter
2. **RabbitMQ publish** — sends the usage event for billing
3. **Direct database write** — if the publish failed, so the usage is not lost

### Lua Script for Atomicity

```lua
local current = redis.call('INCRBY', KEYS[1], ARGV[1])
redis.call('EXPIREAT', KEYS[1], ARGV[2])
return current
```

This ensures the increment and the expiry are atomic. `EXPIREAT` uses the timestamp of the next midnight in UTC, so the key disappears exactly when the next day's counter starts.

## Analytics Publishing (RabbitMQ)

**What it does:** Publishes usage events to RabbitMQ for billing and analytics processing.

### Queue Configuration

| Property | Value |
|----------|-------|
| Queue name | `analytics.usage` |
| Queue type | `quorum` (durable, replicated) |
| Dead letter exchange | `analytics.usage_dlx` |
| Content type | `application/json` |
| Delivery mode | Persistent |

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
| Connection failure | Throws `AnalyticsPublishError`, recorded with stage `connect` |
| Queue declaration rejected (406) | Throws with a diagnostic message about the broker having incompatible queue arguments |
| Channel closed | The channel is invalidated and reconnected |
| Buffer full (backpressure) | Treated as a failure, so the caller retries instead of assuming delivery |
| Publish failed | Retried once, then throws with stage `dropped` |

The publisher also validates its input before dialling the broker: the user ID must not be empty, the count must be a positive integer, and the event ID must be a UUID.

### Fallback: Direct DB Write

If the RabbitMQ publish fails, the usage is written directly to PostgreSQL so it is not lost:

```sql
INSERT INTO "Usage" ("id", "userId", "apiCallCountTotal", "apiCallCountDaily", "lastApiCallReset", "updatedAt", "createdAt")
VALUES (gen_random_uuid(), $1, $2, $2, NOW(), NOW(), NOW())
ON CONFLICT ("userId") DO UPDATE SET ...
```

**The fallback is triggered by the queue, not by Redis.** If Redis fails but the publish succeeds, the event is already in the queue and the worker will flush it — no direct write is needed.

## Caching

**What it does:** Provides fast access to frequently used data.

### Cache Service

Located at `lib/services/cache-service.ts`:

```typescript
export class CacheService {
  constructor(private storage: ICacheStorage) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.storage.get(key)
      if (!data) {
        metrics.cacheOperations.inc({ operation: 'get', status: 'miss' })
        return null
      }
      metrics.cacheOperations.inc({ operation: 'get', status: 'hit' })
      return JsonSerializer.deserialize<T>(data)
    } catch (error) {
      metrics.cacheOperations.inc({ operation: 'get', status: 'error' })
      logger.error({ msg: "Cache Read Error", key, error })
      return null
    }
  }

  async set<T>(key: string, data: T, ttl: number): Promise<void> {
    try {
      const serialized = JsonSerializer.serialize(data)
      await this.storage.setex(key, ttl, serialized)
      metrics.cacheOperations.inc({ operation: 'set', status: 'success' })
    } catch (error) {
      metrics.cacheOperations.inc({ operation: 'set', status: 'error' })
      logger.error({ msg: "Cache Write Error", key, error })
    }
  }
}
```

**Two things to know:** the storage is injected through the constructor, so a test can pass a fake; and the cache **never throws** — a read that fails returns `null` and a write that fails is logged. A cache problem must not take a request down.

## Distributed Locking

**What it does:** Prevents concurrent operations on the same resource.

### Lock Service

Located at `lib/services/lock-service.ts`:

```typescript
export const lockService = {
  async execute<T>(resource: string, task: () => Promise<T>, ttlMs = 5000): Promise<T> {
    const lockKey = `lock:${resource}`
    const lockValue = crypto.randomUUID()

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      let acquired: string | null = null
      try {
        acquired = await redis.set(lockKey, lockValue, "PX", ttlMs, "NX")
      } catch (error) {
        // Redis unavailable — degrade to postgres-only mode: run without lock.
        logger.warn({ msg: "Lock store unavailable, running without lock", resource, error })
        return await task()
      }

      if (acquired) {
        try {
          return await task()
        } finally {
          try {
            await redis.eval(
              `if redis.call("GET", KEYS[1]) == ARGV[1] then redis.call("DEL", KEYS[1]) end`,
              1, lockKey, lockValue
            )
          } catch (error) {
            logger.warn({ msg: "Failed to release lock", resource, error })
          }
        }
      }
      // ... wait and retry
    }

    // Contended without Redis error — also degrade rather than throw.
    logger.warn({ msg: "Could not acquire lock, running without lock", resource })
    return await task()
  },
}
```

**The lock value is a random UUID, and the release is a compare-and-delete.** A blind `DEL` could remove a lock that another process had since taken. The Lua script only deletes the key if it still holds the caller's UUID.

**The lock never blocks the work.** If Redis is unavailable, or if the lock is contended for all ten retries, the task runs anyway without the lock. A transient lock race should not fail a request.

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
- Shares one endpoint between the two signals, swapping the path suffix: the traces go to `/v1/traces` and the logs to `/v1/logs`
- Is **disabled in preview mode**, as well as when no endpoint is configured

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

The context is injected by a pino `mixin` option, which is called for every log record:

```typescript
// lib/infrastructure/logger.ts
export const logger = pino({
  // ...
  mixin() {
    return withTraceContext()
  },
})
```

`withTraceContext()` reads the active OpenTelemetry span and returns its IDs, or an empty object when there is no span.

### Log Export

Logs are also exported over OTLP, so they are queryable in New Relic next to the traces. The exporter is optional: with no `OTEL_EXPORTER_OTLP_ENDPOINT` set the logs stay on stdout only, and a failing exporter never blocks a request.

The export path has three parts:

| File | Role |
|------|------|
| `lib/infrastructure/logging/sink.ts` | Holds the sink on `globalThis` and exports `emitLog`. It lives on `globalThis` rather than in a module variable because Next.js compiles the instrumentation, the app and the proxy as separate layers, each with its own copy of the module |
| `lib/infrastructure/logging/pino-hook.ts` | A pino `logMethod` hook that splits each record into a message and its attributes |
| `lib/infrastructure/tracing.ts` | Installs the OpenTelemetry log sink that writes to the OTLP endpoint |

Each record is exported with its level as the severity, the log message as the body and the remaining fields as attributes, and it inherits the active span so New Relic can link the log to its trace.

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

The handlers are registered from `instrumentation.ts`, and a global flag stops them being registered twice during development hot reloads.

### What Gets Cleaned Up

1. OpenTelemetry tracing (flushes remaining spans)
2. Prisma client (disconnects from PostgreSQL)
3. Redis client (closes the connection)
4. Process exits after a 500 ms grace period

**The 500 ms is a maximum, not a delay.** The exit timer is `unref`'d, so it does not hold the event loop open — the process exits as soon as everything else is done.

**The RabbitMQ connection is not closed on shutdown.** The publisher has a `close()` method, but only the tests call it.

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `ENV_TYPE` | `dev` | Configuration mode: `dev`, `prod` or `preview` |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `DATABASE_URL_REPLICA` | — | Read replica URL (optional) |
| `DB_POOL_MAX` | `5` | Max PostgreSQL connections (1-50) |
| `REDIS_URL` | — | Redis connection string |
| `REDIS_PASSWORD` | — | Redis password (optional if in URL) |
| `RABBITMQ_URL` | — | RabbitMQ connection string |
| `INTERNAL_API_KEY` | — | Key for the load-test bypass |
| `PROMETHEUS_WEB_SCRAPE_TOKEN` | — | Bearer token for the metrics endpoint |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn` or `error` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTEL collector URL (empty = disabled) |
| `OTEL_SERVICE_NAME` | `web` | Service name in traces |
| `AWS_REGION` | `ap-south-1` | AWS region for Secrets Manager and SSM |

The abuse-limiter variables are listed in [Rate Limiting](rate-limiting.md).

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
- Look at `usage_redis_errors_total` and `abuse_redis_errors_total`
- Verify the cache key format

### Tracing not appearing

- Check `OTEL_EXPORTER_OTLP_ENDPOINT` is set correctly
- Verify collector is running and accessible
- Look at logs for "OTEL tracing disabled" message

### Logs are not reaching New Relic

- Check the endpoint is set and reachable
- Look for "OTEL log export disabled" in the logs — that means the exporter failed to install and only stdout is working
- Remember the traces and logs go to different paths on the same endpoint

## Related Documentation

- [Configuration](../getting-started/configuration.md) - Infrastructure settings
- [Rate Limiting](rate-limiting.md) - The two limiters and their Redis keys
- [Observability](../operations/observability.md) - Metrics and monitoring
- [Health Checks](../operations/health.md) - Infrastructure health probes
