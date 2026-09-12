# Quick Start

This guide will help you get the Payment Gateway service running locally in minutes.

## What is the Payment Gateway?

The Payment Gateway is a stateless Go service that:

- **Receives webhooks from Paddle** (payment processor) and validates their signatures
- **Accepts internal events** from your web application
- **Forwards events to RabbitMQ** for downstream processing by `worker-payments`

Think of it as a secure mailroom that checks IDs before forwarding packages to the right department.

## Prerequisites

- **Docker** and **Docker Compose** installed
- **Go 1.21+** (only if you want to run without Docker)

## Quick Start with Docker

### Step 1: Start the Service

```bash
# Navigate to the gateway directory
cd services/payments/gateway

# Start gateway with RabbitMQ (default)
make gateway-up
```

This starts:
- **payment-gateway** on port `8080`
- **RabbitMQ** on port `5672` (AMQP) and `15672` (Management UI)

### Step 2: Verify It's Running

```bash
# Check container status
make gateway-ps

# Test health endpoint
curl http://localhost:8080/healthz
# Response: {"status":"ok"}

# Test readiness
curl http://localhost:8080/readyz
# Response: {"status":"ok","service":"gateway"}
```

### Step 3: Access RabbitMQ Management

Open your browser and go to `http://localhost:15672`:
- **Username:** `guest`
- **Password:** `guest`

You should see the `payment_events` queue ready to receive messages.

## Sending Test Events

### Paddle Webhook (with HMAC signature)

```bash
# Generate a test signature and send a webhook
curl -X POST http://localhost:8080/webhook/paddle \
  -H "Content-Type: application/json" \
  -H "Paddle-Signature: ts=1710000000;h1=..." \
  -d '{
    "event_id": "evt_123",
    "event_type": "subscription.updated",
    "alert_name": "subscription_updated"
  }'
# Response: {"status":"queued"}
```

### Internal Event (with API key)

```bash
curl -X POST http://localhost:8080/internal/events \
  -H "Content-Type: application/json" \
  -H "X-Internal-Key: test_internal_key" \
  -d '{
    "event_id": "evt_456",
    "event_type": "user.cancel_subscription"
  }'
# Response: {"status":"queued"}
```

## Running Without Docker

If you prefer to run the gateway directly:

```bash
# Set required environment variables
export ENV_TYPE=dev
export PADDLE_WEBHOOK_SECRET=whsec_test_secret_min_16_chars
export INTERNAL_API_KEY=test_internal_key_min_16

# Run the gateway
make run
```

**Note:** You'll need a running RabbitMQ instance. Either:
1. Start RabbitMQ separately: `docker run -d -p 5672:5672 -p 15672:15672 rabbitmq:3-management`
2. Or point to an existing instance: `export RABBITMQ_URL=amqp://guest:guest@localhost:5672/`

## Stopping the Service

```bash
# Stop and remove containers
make gateway-down

# Stop and remove containers + volumes (clean slate)
make gateway-down-v
```

## What's Next?

Now that the service is running, explore:

1. **[Architecture](../concepts/architecture.md)** - Understand how the service is built
2. **[Request Flows](../concepts/request-flows.md)** - See how requests move through the system
3. **[Configuration](configuration.md)** - Customize settings for your environment
4. **[API Reference](../components/api.md)** - Complete API documentation

## Troubleshooting

### "Connection refused"

Make sure Docker is running and the containers are up:

```bash
make gateway-ps
# Should show payment-gateway and rabbitmq containers running
```

### "Port already in use"

Another process is using the port. Either:
1. Stop the conflicting process
2. Or change the port: `PORT=8081 make gateway-up`

### Readiness Check Fails (503)

The gateway returns `503` when it can't connect to RabbitMQ. Check:

```bash
# Verify RabbitMQ is running
docker ps | grep rabbitmq

# Check gateway logs for connection errors
make gateway-logs
```

### Health Check Fails

If `/healthz` returns an error, the gateway itself has a problem:

```bash
# Check detailed logs
make gateway-logs

# Restart the service
make gateway-down && make gateway-up
```

## Related Documentation

- [Configuration](configuration.md) - All settings and environment variables
- [Architecture](../concepts/architecture.md) - How the service is structured
- [API Reference](../components/api.md) - Complete API documentation
- [Health](../operations/health.md) - Health check details
