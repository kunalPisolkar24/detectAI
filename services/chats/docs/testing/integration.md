# Integration Tests

This document explains how to write and run integration tests for the Chats service.

## What are Integration Tests?

Integration tests check that multiple parts of the system work together correctly. They're like testing that all the parts of a car work together - engine, transmission, wheels - not just testing each part separately.

**Key characteristics:**
- Test multiple components working together
- Use real databases (MongoDB, Redis)
- Run slower than unit tests (minutes)
- Require Docker

## Why Integration Tests Matter

| Benefit | Explanation |
|---------|-------------|
| **Real-world behavior** | Test with actual databases, not fakes |
| **Catch integration issues** | Find problems that unit tests miss |
| **Verify end-to-end flows** | Ensure complete features work |
| **Test configuration** | Verify database settings are correct |

## Running Integration Tests

```bash
# Run all integration tests
make test-integration

# Run specific test file
go test ./tests/integration/chat_flow_test.go

# Run specific test function
go test -run TestChatFlow ./tests/integration/
```

## Prerequisites

### Docker

Integration tests require Docker to run real databases.

```bash
# Check if Docker is running
docker ps

# Start Docker (if not running)
docker start
```

### Test Containers

The tests use testcontainers to manage Docker containers automatically:

| Container | Image | Purpose |
|-----------|-------|---------|
| MongoDB | `mongo:7` | Primary database (standalone) |
| Redis | `redis:7-alpine` | Cache and streams |
| Sharded MongoDB | `mongo:7` ×4 | True sharding: 1 configsvr + 2 shards + 1 mongos (see below) |

## Sharded MongoDB Tests (`TestSharded_*`)

Standalone MongoDB cannot prove sharding behavior — `EnsureSharding` soft-skips without `mongos`, and there are no chunks to distribute. The `TestSharded_*` tests spin up a real 5-container sharded cluster (1 configsvr + 2 shards + mongos) and assert that sharding works correctly through the router.

| Test | What It Proves (Plain English) |
|------|-------------------------------|
| `EnsureShardingSucceedsViaMongos` | Sharding setup works via mongos and is idempotent |
| `ChatsRemainsUnsharded` | Small collections stay unsharded by design |
| `StandaloneIsNoopOnMongos` | Standalone mode never accidentally shards |
| `CrossChatIsolationViaMongos` | Queries for one chat never leak data from another |
| `BulkUpsertIdempotent/LargeBatch/Pagination` | Writes and pagination survive the router |
| `TargetedQueryUsesShardKey` | Queries hit one shard, not all (performance win) |
| `TestSharded_ConnectConfig` | Production connection settings work against mongos |
| `TestSharded_ChunkDistribution` | Data is spread across both shards |
| `TestSharded_ShardFailure` | Killing a shard fails fast, never returns partial data |
| `TestSharded_Worker_EndToEnd` | Full worker pipeline works on a sharded cluster |

```bash
# Sharded tests only
make test-sharded
```

> **New to sharding?** See [Sharded Cluster Tests](sharded.md) for a beginner-friendly guide covering what sharding is, how the test cluster works, and what each test verifies.

## Test Structure

### Directory Layout

```
chats/
├── tests/
│   └── integration/
│       ├── chat_flow_test.go           # Complete chat flow tests
│       ├── worker_test.go              # Worker processing tests
│       └── repository_test.go          # Database operation tests
├── internal/
│   └── testutil/                       # Test utilities
│       ├── setup.go                    # Test setup helpers
│       └── fixtures.go                 # Test data
```

## Writing Integration Tests

### Basic Test Structure

```go
func TestIntegration(t *testing.T) {
    // Skip if not running integration tests
    if testing.Short() {
        t.Skip("Skipping integration test")
    }
    
    // Setup: Start containers and create service
    ctx := context.Background()
    mongoContainer := setupMongo(ctx)
    redisContainer := setupRedis(ctx)
    defer cleanupContainers(ctx, mongoContainer, redisContainer)
    
    service := setupTestService(ctx, mongoContainer, redisContainer)
    
    // Test: Use the service
    // ...
}
```

### Example: Testing Complete Chat Flow

```go
func TestChatFlow(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test")
    }
    
    // Setup
    ctx := context.Background()
    service := setupTestService(ctx)
    
    // Create a chat
    session, err := service.CreateSession("user123", "Test Chat")
    require.NoError(t, err)
    require.NotEmpty(t, session.ID)
    
    // Save a message
    msg, err := service.ProcessMessage(Message{
        ChatID:  session.ID,
        UserID:  "user123",
        Role:    "user",
        Content: "Hello, world!",
    })
    require.NoError(t, err)
    require.NotEmpty(t, msg.ID)
    
    // Get history
    messages, err := service.GetHistory(session.ID, "user123", 1, 20)
    require.NoError(t, err)
    require.Len(t, messages, 1)
    require.Equal(t, "Hello, world!", messages[0].Content)
    
    // Clean up
    err = service.DeleteSession(session.ID, "user123")
    require.NoError(t, err)
}
```

### Example: Testing Worker Processing

```go
func TestWorkerProcessing(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test")
    }
    
    // Setup
    ctx := context.Background()
    service, worker := setupTestServiceWithWorker(ctx)
    
    // Create a chat
    session, err := service.CreateSession("user123", "Worker Test")
    require.NoError(t, err)
    
    // Save a message (goes to stream)
    _, err = service.ProcessMessage(Message{
        ChatID:  session.ID,
        UserID:  "user123",
        Role:    "user",
        Content: "Test message",
    })
    require.NoError(t, err)
    
    // Wait for worker to process
    time.Sleep(2 * time.Second)
    
    // Verify message was saved to database
    messages, err := service.GetHistory(session.ID, "user123", 1, 20)
    require.NoError(t, err)
    require.Len(t, messages, 1)
}
```

### Example: Testing Error Handling

```go
func TestUnauthorizedAccess(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping integration test")
    }
    
    // Setup
    ctx := context.Background()
    service := setupTestService(ctx)
    
    // Create a chat as user123
    session, err := service.CreateSession("user123", "Private Chat")
    require.NoError(t, err)
    
    // Try to access as different user
    _, err = service.GetHistory(session.ID, "user456", 1, 20)
    require.Error(t, err)
    require.Contains(t, err.Error(), "unauthorized")
}
```

## What to Test

### Complete Flows

| Flow | What to Verify |
|------|----------------|
| **Create and retrieve chat** | Chat is created and can be retrieved |
| **Save and get messages** | Messages are saved and appear in history |
| **User authorization** | Users can only access their own chats |
| **Pagination** | Correct messages returned for each page |

### Database Operations

| Operation | What to Verify |
|-----------|----------------|
| **Index creation** | Database indexes are created correctly |
| **Bulk upserts** | Multiple messages saved efficiently |
| **History queries** | Messages returned in correct order |
| **Deletion** | Chat and messages removed properly |

### Stream Processing

| Operation | What to Verify |
|-----------|----------------|
| **Message publishing** | Messages added to streams |
| **Worker consumption** | Worker picks up and processes messages |
| **Error handling** | Invalid messages handled gracefully |
| **Recovery** | Service recovers from failures |

## Test Utilities

### Setup Helpers

```go
// setupTestService creates a service with real databases
func setupTestService(ctx context.Context) *ChatService {
    // Connect to test containers
    mongoClient := connectToMongo(ctx, mongoContainer)
    redisClient := connectToRedis(ctx, redisContainer)
    
    // Create repositories
    mongoRepo := NewMongoRepository(mongoClient)
    redisRepo := NewRedisRepository(redisClient)
    
    // Create and return service
    return NewChatService(mongoRepo, redisRepo, redisRepo)
}
```

### Fixtures

```go
// fixtures.go provides test data
var TestChat = ChatSession{
    UserID: "user123",
    Title:  "Test Chat",
}

var TestMessage = Message{
    ChatID:  "test-chat-id",
    UserID:  "user123",
    Role:    "user",
    Content: "Test message content",
}
```

## Cleanup

Tests should clean up after themselves:

```go
func TestWithCleanup(t *testing.T) {
    // Setup
    ctx := context.Background()
    service := setupTestService(ctx)
    
    // Create test data
    session, _ := service.CreateSession("user123", "Cleanup Test")
    
    // Ensure cleanup happens
    defer func() {
        service.DeleteSession(session.ID, "user123")
    }()
    
    // Test logic here
}
```

## Troubleshooting

### "Docker not running"

**Problem:** Tests fail because Docker isn't running.

**Solution:**
```bash
# Start Docker
docker start

# Or on macOS
open -a Docker
```

### "Container already exists"

**Problem:** Previous test run didn't clean up containers.

**Solution:**
```bash
# Remove old containers
docker rm -f $(docker ps -q --filter "label=testcontainer")

# Or restart Docker
docker restart
```

### "Connection refused"

**Problem:** Tests can't connect to containers.

**Solution:**
- Wait for containers to start (tests usually handle this)
- Check container logs: `docker logs <container-id>`
- Verify ports aren't conflicting

### "Tests are slow"

**Problem:** Integration tests take too long.

**Solution:**
- Run only necessary tests
- Use `testing.Short()` to skip slow tests
- Check if containers are starting slowly

### "Flaky tests"

**Problem:** Tests sometimes pass, sometimes fail.

**Solution:**
- Add proper waits (not `time.Sleep`)
- Check for race conditions
- Ensure proper cleanup between tests
- Use deterministic test data

## Best Practices

1. **Clean up after tests** - Always delete test data
2. **Use realistic data** - Test with data that resembles production
3. **Test error cases** - Don't just test the happy path
4. **Isolate tests** - Tests shouldn't depend on each other
5. **Use `testing.Short()`** - Allow skipping slow tests

## Related Documentation

- [Testing Overview](overview.md) - All testing levels
- [Unit Tests](unit.md) - Testing individual components
- [HA Tests](ha.md) - High availability testing
