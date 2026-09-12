# Quick Start

This guide will help you get a Workers service running quickly. We'll use the **Payments worker** as an example, but the process is the same for all three workers.

## Prerequisites

- Docker and Docker Compose
- [Bun](https://bun.sh) (for local development)

## Running Locally with Docker

### Step 1: Start a Worker

Each worker runs in its own self-contained Docker Compose stack. Pick one:

```bash
# Navigate to the workers service directory
cd services/workers

# Start the Payments worker (with all its dependencies)
make worker-up WORKER=payments

# Or the Analytics worker
make worker-up WORKER=analytics

# Or the Cron worker
make worker-up WORKER=cron
```

For example, `make worker-up WORKER=payments` starts:
- **worker-payments** - The payments worker process
- **postgres-users** - PostgreSQL database
- **redis-users** - Redis cache (user data, dedup)
- **redis-events** - Redis for Paddle event dedup (payments only)
- **rabbitmq** - Message broker (payments + analytics only)
- **db-migrate** - Runs Prisma migrations on startup

### Step 2: Verify It's Running

```bash
# Check if the stack is healthy
make worker-ps WORKER=payments

# Test the readiness endpoint
curl http://localhost:7003/ready
```

A healthy response looks like:
```json
{
  "status": "ready",
  "timestamp": "2024-09-10T12:00:00.000Z",
  "checks": {
    "db": true,
    "redis": true,
    "eventRedis": true,
    "rabbitmq": true,
    "poolWaiting": 0,
    "poolPressured": false,
    "isShuttingDown": false
  }
}
```

### Step 3: Try It Out

The Payments worker processes messages from a RabbitMQ queue. You can send a test message:

```bash
# Publish a test Paddle webhook event to RabbitMQ
# (This simulates a subscription.created event)
docker exec rabbitmq rabbitmqadmin publish exchange=amq.default routing_key=payment_events \
  payload='{"event_type":"subscription.created","event_id":"test-001","occurred_at":"2024-09-10T12:00:00Z","data":{"custom_data":{"userId":"user123"},"status":"active","subscription_id":"sub_abc","plan_id":"plan_xyz"}}'
```

Check the worker logs to see it process the message:

```bash
make worker-logs WORKER=payments
```

## What Just Happened?

1. **make worker-up** built the Docker image and started all services
2. **Prisma migrations** ran automatically on startup
3. The **worker** connected to RabbitMQ and started consuming from the `payment_events` queue
4. The **health server** started on port 7003 (configurable via `WORKER_PAYMENTS_PORT`)

## Running Locally with Bun

For development with hot-reload, you can run workers directly with Bun:

```bash
# Make sure you have a PostgreSQL, Redis, and RabbitMQ running
# You can start just the datastores:
make worker-up WORKER=payments WITH_POSTGRES=0 WITH_REDIS=0 WITH_EVENTS=0 WITH_RABBITMQ=0

# Then run the worker in watch mode:
make dev-payments

# Or for analytics:
make dev-analytics

# Or for cron:
make dev-cron
```

## Stopping the Service

```bash
# Stop the stack (keeps volumes/data)
make worker-down WORKER=payments

# Stop and remove all data
make worker-down-v WORKER=payments
```

## Running Multiple Workers Side by Side

You can run multiple workers on the same machine. Each gets its own isolated stack:

```bash
# Terminal 1: Cron worker (owns PostgreSQL + Redis)
make worker-up WORKER=cron

# Terminal 2: Payments worker (reuses the datastores from cron)
make worker-up WORKER=payments WITH_POSTGRES=0 WITH_REDIS=0 \
  DATABASE_URL=postgresql://user:password@host.docker.internal:5432/detect_ai \
  REDIS_URL=redis://:user_cache_password@host.docker.internal:6379
```

## Running Tests

```bash
# Unit tests (no Docker required)
make test

# Integration tests (requires Docker containers)
make test-integration

# Integration HA tests (requires Docker containers)
make test-integration-ha
```

## Next Steps

- [Configuration](configuration.md) - Customize settings for your environment
- [Architecture](../concepts/architecture.md) - Understand how the service is built
- [Message Flows](../concepts/message-flows.md) - See how events flow through workers

## Troubleshooting

### "Connection refused"

Make sure Docker is running and the services are started:

```bash
make worker-ps WORKER=payments
```

### "Port already in use"

Another process is using the port. Either stop it or override the port:

```bash
WORKER_PAYMENTS_PORT=7103 make worker-up WORKER=payments
```

### "Service not responding"

Check the worker logs:

```bash
make worker-logs WORKER=payments
```

### Worker starts but readiness fails

The worker boots in degraded mode and retries dependencies. Check:
- PostgreSQL is running and accessible
- Redis is running and accessible
- RabbitMQ is running (payments + analytics only)

Look for connection retry logs in the worker output.
