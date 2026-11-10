# Environment Management

This document explains how environment variables and `.env` files work in DetectAI.

## Overview

DetectAI uses environment variables to configure services. Variables come from multiple sources, with a clear precedence order.

```mermaid
graph TB
    subgraph "Configuration Sources"
        TF[Terraform] --> SM[Secrets Manager]
        EnvFile[.env File] --> Compose[Docker Compose]
        Shell[Shell Environment] --> Compose
    end
    
    subgraph "Runtime"
        Compose --> Containers[Container Env]
        SM --> Apps[App Startup]
        SSM[SSM Parameter Store] --> Apps
    end
```

## Environment Files

| File | Stack | Purpose | Gitignored? |
|------|-------|---------|-------------|
| `infra/docker/local/.env` | Local | Local dev config | Yes |
| `infra/docker/prod/.env` | Production | Prod config | Yes |
| `infra/docker/local/.env.example` | - | Template for local | No |
| `infra/docker/prod/.env.example` | - | Template for prod | No |

### Creating Environment Files

```bash
# Local
cp infra/docker/local/.env.example infra/docker/local/.env

# Production
cp infra/docker/prod/.env.example infra/docker/prod/.env
```

The Makefile creates these automatically if missing.

## Variable Precedence

When the same variable is set in multiple places, the last one wins:

```mermaid
graph LR
    A[".env file"] -->|lowest| D[Container]
    B["Compose environment"] -->|medium| D
    C["Shell env vars"] -->|highest| D
```

Example:

```bash
# .env file
PORT_FRONTEND=3000

# Shell override
PORT_FRONTEND=3001 make local-up  # Uses 3001
```

## How Variables Flow

### Local Stack

```mermaid
sequenceDiagram
    participant Env as .env File
    participant Compose as Docker Compose
    participant Container as Container
    
    Env->>Compose: Reads variables
    Compose->>Compose: Applies defaults
    Compose->>Container: Sets environment
    Container->>Container: App reads env
```

### Production Stack

```mermaid
sequenceDiagram
    participant Env as .env File
    participant Compose as Docker Compose
    participant TF as Terraform
    participant SM as Secrets Manager
    participant Container as Container
    participant App as Application
    
    Env->>Compose: Reads variables
    Compose->>Container: Sets environment
    TF->>SM: Creates/updates secrets
    Container->>App: Starts with env vars
    App->>SM: Fetches secrets
    SM-->>App: Returns URLs, credentials
    App->>App: Connects to datastores
```

## Variable Categories

### Application Ports

```bash
# Frontend
PORT_FRONTEND=3000

# Services
PORT_GATEWAY=8080
DOC_PARSER_PORT=8000
GRPC_PORT=50051
METRICS_PORT=8333

# Chat
CHAT_GRPC_HOST_PORT=50052
CHAT_METRICS_HOST_PORT=9095
CHAT_WORKER_METRICS_PORT_HOST=9099

# Workers
WORKER_ANALYTICS_PORT=7001
WORKER_CRON_PORT=7002
WORKER_PAYMENTS_PORT=7003
```

### Datastore Ports

```bash
POSTGRES_PORT=5432
REDIS_PORT=6379
REDIS_CHAT_PORT=6381
EVENT_REDIS_PORT=6382
MONGO_CHAT_PORT=27018
RABBITMQ_PORT=5672
RABBITMQ_UI_PORT=15672
```

### Database Credentials

```bash
# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=detect_ai
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/detect_ai

# Redis
REDIS_PASSWORD=redis_password
REDIS_CHAT_PASSWORD=test_redis_password
EVENT_REDIS_PASSWORD=event_redis_password

# MongoDB
MONGO_URI=mongodb://localhost:27018/chat_db

# RabbitMQ
RABBITMQ_USER=guest
RABBITMQ_PASS=guest
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

### OAuth (Required for Login)

```bash
GITHUB_ID=your-github-client-id
GITHUB_SECRET=your-github-client-secret
GOOGLE_ID=your-google-client-id
GOOGLE_SECRET=your-google-client-secret
NEXTAUTH_SECRET=your-random-secret
```

### AWS (Production Only)

```bash
AWS_REGION=ap-south-1
AWS_ENDPOINT_URL=http://localhost:4566  # Floci/LocalStack
SSM_ENABLED=true
ENV_TYPE=prod
```

## Service-Specific Variables

### Web App

```bash
# Authentication
NEXTAUTH_SECRET=secret
NEXTAUTH_URL=http://localhost:3000

# Service URLs
AI_SERVICE_URL=grpc://localhost:50051
CHAT_SERVICE_URL=grpc://localhost:50052
FILE_EXTRACTOR_API_URL=http://localhost:8000
PAYMENT_GATEWAY_URL=http://localhost:8080

# External Services
NEXT_PUBLIC_TURNSTILE_SITE_KEY=key
NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=token
```

### Chat Service

```bash
# MongoDB
MONGO_URI=mongodb://localhost:27018/chat_db
MONGO_DATABASE=chat_db
MONGO_MODE=standalone

# Redis
CHAT_REDIS_ADDR=localhost:6381
REDIS_URL=redis://:password@localhost:6381
REDIS_CHAT_PASSWORD=password

# Tuning
CHAT_BATCH_SIZE=100
STREAM_PARTITION_COUNT=1
CACHE_TTL=300
```

### Workers

```bash
# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_PREFETCH=1

# Cron
CRON_CHECK_INTERVAL_MS=900000
CRON_BATCH_SIZE=100

# Payments
PADDLE_API_KEY=key
PADDLE_ENVIRONMENT=sandbox
EVENT_REDIS_URL=redis://localhost:6382
EVENT_REDIS_PASSWORD=password
```

### AI Inference

```bash
# Models
HF_TOKEN=your-huggingface-token
MODEL_CACHE_DIR=/cache

# Tuning
BATCH_SIZE=32
BATCH_TIMEOUT=0.1
MAX_TEXT_CHARS=100000
INFERENCE_PROVIDERS=CPUExecutionProvider
```

## Floci vs Real AWS

The key difference is `AWS_ENDPOINT_URL`:

| Setting | Floci/LocalStack | Real AWS |
|---------|------------------|----------|
| `AWS_ENDPOINT_URL` | `http://localhost:4566` | (empty) |
| `ENV_TYPE` | `prod` | `prod` |
| TLS | `false` | `true` |
| Secrets source | Local emulator | Real Secrets Manager |

### Floci Flow

```mermaid
sequenceDiagram
    participant App as App Container
    participant Floci as Floci (localhost:4566)
    participant SM as Secrets Manager (emulated)
    
    App->>Floci: AWS_ENDPOINT_URL
    App->>SM: Get secret
    SM-->>App: Return URLs
    App->>App: Connect to emulated datastores
```

### Real AWS Flow

```mermaid
sequenceDiagram
    participant App as App Container
    participant AWS as AWS Cloud
    participant SM as Secrets Manager
    
    App->>AWS: IAM credentials
    App->>SM: Get secret
    SM-->>App: Return URLs
    App->>App: Connect to real datastores
```

## Debugging

### View Container Environment

```bash
# List all env vars for a container
docker exec <container> env

# Check specific variable
docker exec <container> printenv DATABASE_URL
```

### Test Variable Expansion

```bash
# See how Docker Compose expands variables
docker compose --env-file infra/docker/local/.env -f infra/docker/local/compose.yml config
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Empty variable | Not set in `.env` | Add to `.env` file |
| Wrong port | Default used | Set explicit port in `.env` |
| Connection refused | Wrong host | Use `host.docker.internal` for host services |
| Auth failed | Wrong credentials | Check `.env` has correct values |

## Best Practices

1. **Never commit `.env` files** - They contain secrets
2. **Use `.env.example` as template** - Document all required variables
3. **Set defaults in compose** - Use `${VAR:-default}` syntax
4. **Override via shell for CI** - Use environment variables in pipelines
5. **Use Secrets Manager for prod** - Don't hardcode credentials

## Next Steps

- [Quick Start](../getting-started/quickstart.md) - Get running quickly
- [Configuration](../getting-started/configuration.md) - All variables documented
- [Secrets](../operations/secrets.md) - How secrets are managed
