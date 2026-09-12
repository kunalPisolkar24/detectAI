# Workers Service Documentation

Welcome to the Workers service documentation. This guide will help you understand how the service works and how to use it.

## New to This Service?

Start here:

1. **[Quick Start](getting-started/quickstart.md)** - Get a worker running in minutes
2. **[Architecture](concepts/architecture.md)** - Learn how the service is structured
3. **[Configuration](getting-started/configuration.md)** - Set up the service for your environment

## What is the Workers Service?

The Workers service is a TypeScript/Bun backend that handles background processing for the DetectAI platform. It runs as **three independent worker processes**, each handling a specific domain:

| Worker | What It Does | Dependencies |
|--------|--------------|--------------|
| **Payments** | Processes Paddle webhooks (subscription lifecycle) | PostgreSQL, Redis, Events Redis, RabbitMQ |
| **Analytics** | Tracks usage events (API call counting) | PostgreSQL, Redis, RabbitMQ |
| **Cron** | Sweeps expired subscriptions, resets daily usage counters | PostgreSQL, Redis |

Each worker runs in its own Docker Compose stack with only the datastores it needs.

## Documentation by Topic

### Getting Started

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Quick Start](getting-started/quickstart.md) | Run a worker locally | First time using the service |
| [Configuration](getting-started/configuration.md) | All settings and how to configure them | Setting up the service |

### Concepts

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Architecture](concepts/architecture.md) | How the service is built and why | Understanding the system |
| [Message Flows](concepts/message-flows.md) | How events move through each worker | Understanding the flow |

### Components

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Payments Worker](components/payments-worker.md) | Paddle webhook processing in detail | Working with payments |
| [Analytics Worker](components/analytics-worker.md) | Usage event tracking in detail | Working with analytics |
| [Cron Worker](components/cron-worker.md) | Subscription sweeping in detail | Working with cron jobs |

### Operations

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Health](operations/health.md) | Health checks and monitoring | Monitoring the service |
| [Observability](operations/observability.md) | Metrics, logs, and alerts | Monitoring and debugging |

### Reference

| Document | What You'll Learn | When to Read |
|----------|-------------------|--------------|
| [Sweep NULL Audit](reference/sweep-null-audit.sql) | SQL queries for data hygiene | Auditing subscription data |

## Reading Order for Different Roles

### New Developers
1. [Quick Start](getting-started/quickstart.md) - Get a worker running
2. [Architecture](concepts/architecture.md) - Understand the big picture
3. [Message Flows](concepts/message-flows.md) - See how events flow
4. [Configuration](getting-started/configuration.md) - Set up your environment

### DevOps/SRE
1. [Quick Start](getting-started/quickstart.md) - Get it running
2. [Configuration](getting-started/configuration.md) - Configure the service
3. [Health](operations/health.md) - Set up monitoring
4. [Observability](operations/observability.md) - Configure metrics and alerts
5. [Architecture](concepts/architecture.md) - Understand the components

### Backend Developers
1. [Payments Worker](components/payments-worker.md) - Understand payment processing
2. [Analytics Worker](components/analytics-worker.md) - Understand usage tracking
3. [Message Flows](concepts/message-flows.md) - Understand event flows
4. [Cron Worker](components/cron-worker.md) - Understand background jobs

## Related Files

- **Main README**: [`../../README.md`](../../README.md) - Project overview
- **Makefile**: [`../../Makefile`](../../Makefile) - Build and run commands
- **Docker Compose**: [`../../infra/compose.payments.yml`](../../infra/compose.payments.yml) - Payments stack
- **Docker Compose**: [`../../infra/compose.analytics.yml`](../../infra/compose.analytics.yml) - Analytics stack
- **Docker Compose**: [`../../infra/compose.cron.yml`](../../infra/compose.cron.yml) - Cron stack
- **Prisma Schema**: [`../../prisma/schema.prisma`](../../prisma/schema.prisma) - Database models
