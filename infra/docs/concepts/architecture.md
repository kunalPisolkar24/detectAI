# Architecture

This document explains how the DetectAI infrastructure is structured and why it's designed this way.

## Overview

DetectAI is a microservices-based platform for AI text detection. The infrastructure consists of two main layers:

1. **Application Services** - The running code (web app, workers, inference, etc.)
2. **Datastores** - Where data lives (PostgreSQL, MongoDB, Redis, RabbitMQ)

```mermaid
graph TB
    subgraph "Application Layer"
        Web[Web App<br/>Next.js :3000]
        Gateway[Payment Gateway<br/>Go :8080]
        DocParser[Document Parser<br/>Python :8000]
        Inference[AI Inference<br/>Python :50051]
        ChatAPI[Chat API<br/>Go :50052]
        ChatWorker[Chat Worker<br/>Go]
        Workers[Workers<br/>TypeScript :7001-7003]
    end
    
    subgraph "Data Layer"
        PG[(PostgreSQL<br/>:5432)]
        Mongo[(MongoDB<br/>:27018)]
        RedisUsers[(Redis Users<br/>:6379)]
        RedisChat[(Redis Chat<br/>:6381)]
        RedisEvents[(Redis Events<br/>:6382)]
        RabbitMQ[(RabbitMQ<br/>:5672)]
    end
    
    Web --> PG
    Web --> RedisUsers
    Web --> Inference
    Web --> ChatAPI
    Web --> DocParser
    Web --> Gateway
    
    ChatAPI --> Mongo
    ChatAPI --> RedisChat
    ChatWorker --> Mongo
    ChatWorker --> RedisChat
    
    Gateway --> RabbitMQ
    Workers --> RabbitMQ
    Workers --> PG
    Workers --> RedisUsers
    Workers --> RedisEvents
```

## Two Deployment Modes

DetectAI supports two deployment modes with the same codebase:

```mermaid
graph LR
    subgraph "Local Development"
        Local[make local-up]
        LocalDocker[Docker Compose<br/>All services + datastores]
    end
    
    subgraph "Production"
        Prod[make prod-up]
        ProdDocker[Docker Compose<br/>App services only]
        TF[Terraform<br/>Managed datastores]
    end
    
    Local --> LocalDocker
    Prod --> ProdDocker
    Prod --> TF
    TF --> ProdDocker
```

| Mode | Command | Datastores | Use Case |
|------|---------|------------|----------|
| **Local** | `make local-up` | Docker containers | Daily development |
| **Production** | `make prod-up` | AWS (Terraform-managed) | Staging/production |

**Why two modes?**
- **Local**: Everything runs in Docker, zero AWS dependency, fast iteration
- **Production**: App services in Docker, datastores managed by Terraform on AWS

## The Compose Atom Pattern

Instead of one giant compose file, infrastructure is broken into reusable "atoms":

```mermaid
graph TB
    subgraph "Atoms (Single Definition)"
        PGAtom[postgres-users/<br/>standalone.yml]
        RedisUsersAtom[redis-users/<br/>standalone.yml]
        RedisChatAtom[redis-chat/<br/>standalone.yml]
        RedisEventsAtom[redis-events/<br/>standalone.yml]
        MongoAtom[mongo-chat/<br/>standalone.yml]
        RabbitMQAtom[rabbitmq/<br/>standalone.yml]
    end
    
    subgraph "Stacks (Import Atoms)"
        LocalStack[local/compose.yml]
        ProdStack[prod/compose.yml]
    end
    
    LocalStack -->|include:| PGAtom
    LocalStack -->|include:| RedisUsersAtom
    LocalStack -->|include:| RedisChatAtom
    LocalStack -->|include:| RedisEventsAtom
    LocalStack -->|include:| MongoAtom
    LocalStack -->|include:| RabbitMQAtom
    
    ProdStack -.->|app services only| LocalStack
```

**Benefits:**
- Each datastore defined once (no duplication)
- Multiple stacks can share the same atom
- Easy to test individual datastores
- Consistent configuration across environments

## Data Flow

### User Text Detection Flow

```mermaid
sequenceDiagram
    participant User as User
    participant Web as Web App
    participant Parser as Document Parser
    participant Inference as AI Inference
    participant Chat as Chat Service
    participant Mongo as MongoDB
    participant Redis as Redis Chat
    
    User->>Web: Upload document / paste text
    alt Document upload
        Web->>Parser: Extract text
        Parser-->>Web: Return text
    end
    Web->>Inference: Analyze text (gRPC)
    Inference-->>Web: Return scores (human/ai)
    Web->>Chat: Save message with analysis
    Chat->>Redis: Update cache
    Chat->>Mongo: Persist (via worker)
    Chat-->>Web: Confirmation
    Web-->>User: Show results
```

### Payment Webhook Flow

```mermaid
sequenceDiagram
    participant Paddle as Paddle
    participant Gateway as Payment Gateway
    participant RabbitMQ as RabbitMQ
    participant Workers as Workers
    participant PG as PostgreSQL
    participant Redis as Redis Events
    
    Paddle->>Gateway: Webhook event
    Gateway->>Gateway: Validate signature
    Gateway->>Redis: Check dedup
    alt Not duplicate
        Gateway->>RabbitMQ: Publish event
        Gateway-->>Paddle: 200 OK
        RabbitMQ->>Workers: Consume event
        Workers->>PG: Update subscription
        Workers->>Redis: Store dedup key
    else Duplicate
        Gateway-->>Paddle: 200 OK (idempotent)
    end
```

## Terraform Structure

Terraform manages the stateful datastores on AWS:

```mermaid
graph TB
    subgraph "Root Module"
        Main[main.tf]
        Vars[variables.tf]
        Outputs[outputs.tf]
    end
    
    subgraph "Modules"
        PG[modules/postgres]
        DocDB[modules/docdb]
        Redis[modules/elasticache]
        MQ[modules/mq]
    end
    
    subgraph "Environments"
        Local[envs/floci-local.tfvars]
        Floci[envs/floci.tfvars]
        Prod[envs/prod.tfvars]
    end
    
    Main --> PG
    Main --> DocDB
    Main --> Redis
    Main --> MQ
    
    Local --> Main
    Floci --> Main
    Prod --> Main
```

### The Secret Contract

Terraform doesn't just create resources -- it composes connection URLs and stores them in AWS Secrets Manager:

```mermaid
graph LR
    subgraph "Terraform Modules"
        PGModule[Postgres Module]
        DocDBModule[DocDB Module]
        RedisModule[ElastiCache Module]
        MQModule[MQ Module]
    end
    
    subgraph "Secrets Manager"
        PGSecret[detectai/pg/urls]
        DocDBSecret[detectai/docdb/urls]
        RedisChatSecret[detectai/redis/chat/urls]
        RedisEventsSecret[detectai/redis/events/urls]
        RedisUsersSecret[detectai/redis/users/urls]
        MQSecret[detectai/mq/urls]
    end
    
    PGModule -->|DATABASE_URL| PGSecret
    DocDBModule -->|MONGO_URI| DocDBSecret
    RedisModule -->|REDIS_URL| RedisChatSecret
    RedisModule -->|EVENT_REDIS_URL| RedisEventsSecret
    RedisModule -->|REDIS_URL| RedisUsersSecret
    MQModule -->|RABBITMQ_URL| MQSecret
```

Apps fetch these secrets at startup -- they never construct URLs themselves.

## Why This Design?

| Benefit | Explanation |
|---------|-------------|
| **Environment Parity** | Same code runs locally and in production |
| **Separation of Concerns** | Each service owns its data and logic |
| **Scalability** | Services can be scaled independently |
| **Testability** | Each component can be tested in isolation |
| **Maintainability** | Clear boundaries between components |
| **Cost Efficiency** | Local uses Docker, prod uses managed services |

## Service Responsibilities

| Service | Language | Port | Responsibility |
|---------|----------|------|----------------|
| **Web** | TypeScript | 3000 | User interface, auth, API routes |
| **Payment Gateway** | Go | 8080 | Paddle webhook validation, event publishing |
| **Document Parser** | Python | 8000 | Text extraction from PDF, DOCX, etc. |
| **AI Inference** | Python | 50051 | Text analysis, AI detection scoring |
| **Chat API** | Go | 50052 | Chat session management, message storage |
| **Chat Worker** | Go | - | Background message persistence |
| **Worker Analytics** | TypeScript | 7001 | Analytics event processing |
| **Worker Cron** | TypeScript | 7002 | Scheduled background tasks |
| **Worker Payments** | TypeScript | 7003 | Payment event processing |

## Next Steps

- [Docker Compose](docker-compose.md) - How compose stacks work
- [Terraform](terraform.md) - Infrastructure as code details
- [Datastores](../components/datastores.md) - What each datastore does
