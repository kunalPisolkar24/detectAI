# Datastores

This document explains each datastore in DetectAI, what it stores, and why it's used.

## Overview

DetectAI uses four types of datastores, each with a specific purpose:

```mermaid
graph TB
    subgraph "Datastores"
        PG[(PostgreSQL<br/>Users & Subscriptions)]
        Mongo[(MongoDB<br/>Chat Messages)]
        RedisU[(Redis Users<br/>Cache & Rate Limit)]
        RedisC[(Redis Chat<br/>Cache & Streams)]
        RedisE[(Redis Events<br/>Payment Dedup)]
        RabbitMQ[(RabbitMQ<br/>Message Queue)]
    end
    
    subgraph "Services"
        Web[Web App]
        Chat[Chat Service]
        Workers[Workers]
        Gateway[Gateway]
    end
    
    Web --> PG
    Web --> RedisU
    Chat --> Mongo
    Chat --> RedisC
    Workers --> PG
    Workers --> RabbitMQ
    Workers --> RedisU
    Workers --> RedisE
    Gateway --> RabbitMQ
    Gateway --> RedisE
```

## PostgreSQL

**Purpose**: User accounts, subscriptions, usage tracking

| Detail | Value |
|--------|-------|
| **Engine** | Aurora PostgreSQL 16.6 (prod) / PostgreSQL 16 (local) |
| **Port** | 5432 |
| **ORM** | Prisma |
| **Database** | `detect_ai` |

### What It Stores

| Table | Purpose |
|-------|---------|
| `User` | User accounts, authentication |
| `Subscription` | Paddle subscription state |
| `Usage` | API usage tracking |
| `ProcessedWebhook` | Payment webhook deduplication |

### Connection

```bash
# Local
postgresql://postgres:postgres@localhost:5432/detect_ai

# From Terraform output
psql "$(terraform output -raw database_url)" -c "select 1"
```

### Why PostgreSQL?

- **Relational data**: Users have subscriptions, which have usage records
- **ACID transactions**: Subscription updates must be atomic
- **Prisma ORM**: Type-safe database access
- **Read replicas**: Separate read/write paths for scaling

## MongoDB (DocumentDB)

**Purpose**: Chat messages and sessions

| Detail | Value |
|--------|-------|
| **Engine** | DocumentDB 5.0.0 (prod) / MongoDB 6.0 (local) |
| **Port** | 27018 (host) / 27017 (container) |
| **Database** | `chat_db` |
| **Pattern** | Bucket pattern (50 messages per document) |

### What It Stores

| Collection | Purpose |
|------------|---------|
| `chats` | Chat session metadata |
| `messages` | Message buckets (50 messages each) |

### Why MongoDB?

- **Flexible schema**: Messages have variable metadata
- **Bucket pattern**: Efficient storage for message lists
- **DocumentDB compatibility**: Same API in local and prod
- **Sharding support**: Can scale horizontally for chat data

### Bucket Pattern

Instead of one document per message, messages are grouped into buckets:

```
Message Bucket Document:
{
  _id: "bucket-123",
  chat_id: "chat-456",
  bucket_index: 1726000000000000000,  // Unix nano
  count: 47,                           // Messages in bucket (max 50)
  messages: [                          // Embedded array
    { _id: "msg-1", content: "Hello", ... },
    { _id: "msg-2", content: "Hi!", ... },
    ...
  ]
}
```

**Benefits**: Fewer documents, faster reads, atomic updates

## Redis (3 Instances)

Redis is used for three distinct purposes, each with its own instance:

### Redis Users

| Detail | Value |
|--------|-------|
| **Port** | 6379 |
| **Purpose** | User cache, rate limiting, analytics dedup |
| **Eviction** | `volatile-ttl` |
| **Persistence** | AOF |

**What it stores:**
- User profile cache (TTL'd)
- Rate limit counters
- Analytics event dedup keys

**Why `volatile-ttl`?** Rate limit keys have TTLs; we want them to expire naturally, not be evicted early.

### Redis Chat

| Detail | Value |
|--------|-------|
| **Port** | 6381 |
| **Purpose** | Chat cache + Redis Streams |
| **Eviction** | Default |
| **Persistence** | AOF |
| **HA** | Primary + Replica (prod) |

**What it stores:**
- Recent message cache (for fast reads)
- Redis Streams (message queue between API and worker)

**Why HA?** Chat data is critical; losing the cache means slower reads, losing streams means lost messages.

### Redis Events

| Detail | Value |
|--------|-------|
| **Port** | 6382 |
| **Purpose** | Payment webhook deduplication |
| **Eviction** | `noeviction` |
| **Persistence** | AOF + RDB snapshots |

**What it stores:**
- `paddle:evt:{eventId}` -> `"1"` (7-day TTL)
- `payment:event:ts:{userId}` -> ISO timestamp (30-day TTL)

**Why `noeviction`?** Losing a dedup key means double-crediting a user. We'd rather reject new writes than lose existing dedup state.

### Why 3 Redis Instances?

| Reason | Explanation |
|--------|-------------|
| **Isolation** | Different failure domains |
| **Different configs** | HA vs single-node, different eviction |
| **Security** | Separate auth tokens |
| **Performance** | No resource contention |

## RabbitMQ (Amazon MQ)

**Purpose**: Async message queuing for payments and analytics

| Detail | Value |
|--------|-------|
| **Engine** | RabbitMQ 3.13 |
| **Port** | 5672 (AMQP) / 15672 (Management) |
| **Queue Type** | Quorum (durable, replicated) |

### What It Queues

| Queue | Producer | Consumer | Purpose |
|-------|----------|----------|---------|
| Payment events | Gateway | worker-payments | Process Paddle webhooks |
| Analytics events | Web app | worker-analytics | Track user events |

### Why RabbitMQ?

- **Reliable delivery**: Messages persist to disk
- **Quorum queues**: Replicated across nodes (prod)
- **Dead letter queues**: Failed messages are retried
- **Management UI**: Easy monitoring

### Message Flow

```mermaid
sequenceDiagram
    participant Producer as Producer
    participant RabbitMQ as RabbitMQ
    participant Consumer as Consumer
    participant DLQ as Dead Letter Queue
    
    Producer->>RabbitMQ: Publish message
    RabbitMQ->>RabbitMQ: Persist to disk
    RabbitMQ->>Consumer: Deliver message
    
    alt Processing fails
        Consumer->>RabbitMQ: Nack message
        RabbitMQ->>DLQ: Move to DLQ (after retries)
    else Processing succeeds
        Consumer->>RabbitMQ: Ack message
    end
```

## Datastore Selection Guide

| Use Case | Datastore | Why |
|----------|-----------|-----|
| User accounts | PostgreSQL | Relational, ACID |
| Chat messages | MongoDB | Flexible schema, bucket pattern |
| Rate limiting | Redis | Fast, TTL support |
| Session cache | Redis | Fast, automatic expiration |
| Message queue | RabbitMQ | Reliable, durable |
| Event dedup | Redis | Fast lookup, TTL |
| Payment dedup | Redis (noeviction) | Never lose dedup state |

## Health Checks

| Datastore | Health Check Command |
|-----------|---------------------|
| PostgreSQL | `pg_isready -U postgres -d detect_ai` |
| MongoDB | `mongosh --eval db.adminCommand('ping')` |
| Redis | `redis-cli -a <password> ping` |
| RabbitMQ | `rabbitmq-diagnostics -q ping` |

## Connection Strings

### PostgreSQL

```
postgresql://<user>:<password>@<host>:<port>/<database>?sslmode=<mode>
```

### MongoDB

```
mongodb://<user>:<password>@<host>:<port>/<database>?tls=<bool>&retryWrites=false&authSource=admin
```

### Redis

```
redis://:<password>@<host>:<port>          # Without TLS
rediss://:<password>@<host>:<port>         # With TLS
```

### RabbitMQ

```
amqps://<user>:<password>@<host>:<port>/   # With TLS
amqp://<user>:<password>@<host>:<port>/    # Without TLS
```

## Next Steps

- [Standalone Atoms](standalone-atoms.md) - How datastores are containerized
- [Terraform](../concepts/terraform.md) - How datastores are managed on AWS
- [Secrets](../operations/secrets.md) - How credentials are managed
