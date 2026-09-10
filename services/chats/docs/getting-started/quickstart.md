# Quick Start

This guide will help you get the Chats service running quickly.

## Prerequisites

- Docker and Docker Compose
- Go 1.21+ (for local development)

## Running Locally

### Step 1: Start the Service

```bash
# Navigate to the chats service directory
cd services/chats

# Start the service with databases
docker compose -f infra/compose.yml up -d --build
```

This starts:
- **chat-service** - The API server on port 50051
- **chat-worker** - The background processor
- **mongo-chat** - MongoDB on port 27018
- **redis-chat** - Redis on port 6381

### Step 2: Verify It's Running

```bash
# Check if services are healthy
docker compose -f infra/compose.yml ps

# Test the health endpoint
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

### Step 3: Try It Out

#### Create a Chat

```bash
grpcurl -plaintext -d '{
  "user_id": "user123",
  "title": "My First Chat"
}' localhost:50051 chat.ChatService/CreateChat
```

Response:
```json
{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Save a Message

```bash
grpcurl -plaintext -d '{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user123",
  "role": "user",
  "content": "Hello, world!"
}' localhost:50051 chat.ChatService/SaveMessage
```

#### Get Chat History

```bash
grpcurl -plaintext -d '{
  "chat_id": "550e8400-e29b-41d4-a716-446655440000",
  "page": 1,
  "page_size": 20
}' localhost:50051 chat.ChatService/GetChatHistory
```

## What Just Happened?

1. **CreateChat** - Created a new chat session in MongoDB
2. **SaveMessage** - Added the message to Redis Stream (for async processing)
3. **GetChatHistory** - Retrieved messages from Redis cache (fast path)

The message is also being processed by the worker in the background and will be permanently saved to MongoDB.

## Next Steps

- [Configuration](configuration.md) - Customize settings for your environment
- [Architecture](../concepts/architecture.md) - Understand how the service is built
- [API Reference](../components/api.md) - Complete API documentation

## Troubleshooting

### "Connection refused"

Make sure Docker is running and the services are started:
```bash
docker compose -f infra/compose.yml ps
```

### "Port already in use"

Another process is using the port. Either stop it or change the port in configuration.

### "Service not responding"

Check the logs:
```bash
docker compose -f infra/compose.yml logs chat-service
```

## Running Tests

```bash
# Unit tests (no Docker)
make test

# Integration tests (requires Docker)
make test-integration

# Load tests
make load-test SCENARIO=smoke VUS=1 DURATION=10s
```

## Stopping the Service

```bash
# Stop all services
docker compose -f infra/compose.yml down

# Stop and remove volumes
docker compose -f infra/compose.yml down -v
```
