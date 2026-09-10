# Chats Service

A service that stores and retrieves chat conversations. It handles creating chats, saving messages, and retrieving chat history.

## What This Service Does

The Chats service is responsible for:

- **Storing chat sessions** - Creating and managing chat conversations
- **Saving messages** - Storing user and assistant messages in each chat
- **Retrieving history** - Fetching previous messages from a chat
- **Managing users** - Ensuring users can only access their own chats

## How It Works

The service runs in two modes:

1. **API mode** - Handles incoming requests from users
2. **Worker mode** - Processes messages in the background

When a user sends a message:
1. The API receives the message and stores it temporarily
2. A background worker picks up the message
3. The worker saves it permanently to the database
4. The message becomes available for retrieval

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Go 1.21+ (for local development)

### Running Locally

```bash
# Start the service with databases
docker compose -f infra/compose.yml up -d --build

# The gRPC API is available at localhost:50051
```

### Basic Usage

```bash
# Create a new chat
grpcurl -plaintext -d '{"user_id": "user123", "title": "My Chat"}' \
  localhost:50051 chat.ChatService/CreateChat

# Save a message
grpcurl -plaintext -d '{
  "chat_id": "your-chat-id",
  "user_id": "user123",
  "role": "user",
  "content": "Hello, world!"
}' localhost:50051 chat.ChatService/SaveMessage

# Get chat history
grpcurl -plaintext -d '{"chat_id": "your-chat-id", "page": 1, "page_size": 20}' \
  localhost:50051 chat.ChatService/GetChatHistory
```

## Key Concepts

| Term | What It Means |
|------|---------------|
| **gRPC** | A way for applications to communicate (like REST, but faster) |
| **Worker** | A background process that handles tasks without blocking the main service |
| **Stream** | A buffer that holds messages temporarily before they're saved permanently |
| **Cache** | Fast storage for frequently accessed data (recent messages) |
| **DLQ** | Dead Letter Queue - stores messages that failed to process |
| **Hexagonal Architecture** | A design pattern that separates business logic from external systems |

## Configuration

The service is configured using environment variables. The most important ones:

```bash
# Required
SERVICE_ROLE=api          # or 'worker'
MONGO_URI=mongodb://mongo-chat:27017
CHAT_REDIS_ADDR=redis-chat:6379

# Optional
MONGO_DATABASE=chat_db
STREAM_PARTITION_COUNT=16
BATCH_SIZE=50
CACHE_TTL=24h
```

See [Configuration](docs/getting-started/configuration.md) for all options.

## API Reference

The service exposes a gRPC API with these methods:

| Method | Description |
|--------|-------------|
| `CreateChat` | Create a new chat session |
| `GetChat` | Get a specific chat |
| `GetUserChats` | List all chats for a user |
| `RenameChat` | Change a chat's title |
| `DeleteChat` | Delete a chat and its messages |
| `SaveMessage` | Save a message to a chat |
| `GetChatHistory` | Get messages from a chat |

See [API Reference](docs/components/api.md) for detailed documentation.

## Documentation

| Guide | What You'll Learn |
|-------|-------------------|
| [Quick Start](docs/getting-started/quickstart.md) | Get the service running |
| [Architecture](docs/concepts/architecture.md) | How the service is structured |
| [Request Flows](docs/concepts/request-flows.md) | How requests are processed |
| [Configuration](docs/getting-started/configuration.md) | All configuration options |
| [API Reference](docs/components/api.md) | Complete API documentation |
| [Validation](docs/components/validation.md) | Input validation rules |
| [Caching](docs/concepts/caching.md) | How caching works |
| [Streaming](docs/components/streaming.md) | How messages flow through the system |
| [Worker](docs/components/worker.md) | Background processing details |
| [Health](docs/operations/health.md) | Health checks and monitoring |
| [Observability](docs/operations/observability.md) | Metrics and monitoring |
| [Testing](docs/testing/overview.md) | How to test the service |

## Development

### Running Tests

```bash
# Unit tests (no Docker required)
make test

# Integration tests (requires Docker)
make test-integration

# Load tests
make load-test SCENARIO=smoke VUS=1 DURATION=10s
```

### Project Structure

```
chats/
├── api/proto/          # gRPC protocol definitions
├── internal/
│   ├── config/         # Configuration
│   ├── core/
│   │   ├── domain/     # Business objects
│   │   ├── ports/      # Interfaces
│   │   └── usecase/    # Business logic
│   ├── adapters/       # External system connections
│   └── mocks/          # Test mocks
├── tests/              # Test files
└── docs/               # Documentation
```

## Troubleshooting

**Service won't start?**
- Check that MongoDB and Redis are running
- Verify `MONGO_URI` and `CHAT_REDIS_ADDR` are correct

**Messages not saving?**
- Check if the worker is running (`SERVICE_ROLE=worker`)
- Look at logs for stream errors

**Can't connect to the API?**
- Ensure the service is listening on the correct port (`GRPC_PORT=:50051`)
- Check firewall rules

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.
