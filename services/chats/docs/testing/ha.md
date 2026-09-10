# HA Tests

This document explains how to write and run high-availability (HA) tests for the Chats service.

## What are HA Tests?

HA tests check that the service works correctly in production-like environments with features like database replication, authentication, and failover. They're like testing that a car works not just in a garage, but on actual roads with traffic, hills, and weather.

**Key characteristics:**
- Test with production-like configurations
- Use database replica sets and authentication
- Test failover and recovery scenarios
- Require Docker

## Why HA Tests Matter

| Benefit | Explanation |
|---------|-------------|
| **Production confidence** | Test with the same setup as production |
| **Failover testing** | Verify the service handles database failures |
| **Security validation** | Ensure authentication works correctly |
| **Performance validation** | Test under realistic conditions |

## Running HA Tests

```bash
# Run all HA tests
make test-ha

# Run specific test file
go test ./tests/integration/ha_test.go

# Run specific test function
go test -run TestReplicaSet ./tests/integration/
```

## Prerequisites

### Docker

HA tests require Docker to run databases with HA configurations.

### HA Containers

The tests use Docker containers with HA features:

| Container | Configuration | Purpose |
|-----------|---------------|---------|
| MongoDB | Replica set with auth | Test replication and authentication |
| Redis | Primary + replica | Test failover and authentication |

## Test Structure

### Directory Layout

```
chats/
├── tests/
│   └── integration/
│       ├── ha_test.go                  # HA-specific tests
│       ├── ha_mongo_test.go           # MongoDB HA tests
│       └── ha_redis_test.go           # Redis HA tests
├── internal/
│   └── testutil/
│       ├── ha_setup.go                # HA test setup
│       └── ha_fixtures.go             # HA test data
```

## Writing HA Tests

### Basic HA Test Structure

```go
func TestHA(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping HA test")
    }
    
    // Setup: Start HA containers
    ctx := context.Background()
    mongoContainer := setupHAMongo(ctx)
    redisContainer := setupHARedis(ctx)
    defer cleanupHAContainers(ctx, mongoContainer, redisContainer)
    
    service := setupHAService(ctx, mongoContainer, redisContainer)
    
    // Test: Use the service with HA features
    // ...
}
```

### Example: Testing MongoDB Replica Set

```go
func TestReplicaSet(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping HA test")
    }
    
    // Setup
    ctx := context.Background()
    service := setupHAService(ctx)
    
    // Create a chat
    session, err := service.CreateSession("user123", "HA Test")
    require.NoError(t, err)
    
    // Save a message
    msg, err := service.ProcessMessage(Message{
        ChatID:  session.ID,
        UserID:  "user123",
        Role:    "user",
        Content: "HA test message",
    })
    require.NoError(t, err)
    
    // Verify message was saved to primary
    messages, err := service.GetHistory(session.ID, "user123", 1, 20)
    require.NoError(t, err)
    require.Len(t, messages, 1)
    
    // Simulate primary failure (container restart)
    // This tests that the service can reconnect
    restartContainer(ctx, mongoContainer)
    
    // Wait for reconnection
    time.Sleep(5 * time.Second)
    
    // Verify service still works
    messages, err = service.GetHistory(session.ID, "user123", 1, 20)
    require.NoError(t, err)
    require.Len(t, messages, 1)
}
```

### Example: Testing Redis Authentication

```go
func TestRedisAuth(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping HA test")
    }
    
    // Setup
    ctx := context.Background()
    service := setupHAService(ctx)
    
    // Test with correct credentials
    err := service.Ping()
    require.NoError(t, err)
    
    // Test with wrong credentials (should fail)
    wrongService := setupHAServiceWithWrongPassword(ctx)
    err = wrongService.Ping()
    require.Error(t, err)
    require.Contains(t, err.Error(), "invalid credentials")
}
```

### Example: Testing Failover

```go
func TestFailover(t *testing.T) {
    if testing.Short() {
        t.Skip("Skipping HA test")
    }
    
    // Setup
    ctx := context.Background()
    service := setupHAService(ctx)
    
    // Create some data
    session, _ := service.CreateSession("user123", "Failover Test")
    service.ProcessMessage(Message{
        ChatID:  session.ID,
        UserID:  "user123",
        Role:    "user",
        Content: "Before failover",
    })
    
    // Stop primary database
    stopPrimary(ctx)
    
    // Wait for failover
    time.Sleep(10 * time.Second)
    
    // Verify service can still read (from replica)
    messages, err := service.GetHistory(session.ID, "user123", 1, 20)
    require.NoError(t, err)
    require.Len(t, messages, 1)
    
    // Restart primary
    startPrimary(ctx)
    
    // Wait for reconnection
    time.Sleep(5 * time.Second)
    
    // Verify writes work again
    _, err = service.ProcessMessage(Message{
        ChatID:  session.ID,
        UserID:  "user123",
        Role:    "user",
        Content: "After failover",
    })
    require.NoError(t, err)
}
```

## What to Test

### MongoDB HA

| Scenario | What to Verify |
|----------|----------------|
| **Replica set** | Data replicates to secondaries |
| **Primary failover** | Service continues working during failover |
| **Authentication** | Only authenticated connections work |
| **Connection pooling** | Pool handles connection failures gracefully |

### Redis HA

| Scenario | What to Verify |
|----------|----------------|
| **Primary-replica** | Data replicates correctly |
| **Authentication** | Only authenticated connections work |
| **Failover** | Service handles Redis failures |
| **TLS** | Encrypted connections work |

### Service Behavior

| Scenario | What to Verify |
|----------|----------------|
| **Database restart** | Service reconnects automatically |
| **Network issues** | Service handles timeouts gracefully |
| **Credential rotation** | Service works with new credentials |
| **Connection limits** | Pool handles many connections |

## HA Setup Helpers

### MongoDB Replica Set

```go
func setupHAMongo(ctx context.Context) *Container {
    // Start MongoDB with replica set
    req := testcontainers.ContainerRequest{
        Image:        "mongo:7",
        ExposedPorts: []string{"27017"},
        Cmd:          []string{"--replSet", "rs0", "--auth"},
        Env: map[string]string{
            "MONGO_INITDB_ROOT_USERNAME": "admin",
            "MONGO_INITDB_ROOT_PASSWORD": "password",
        },
    }
    // ...
}
```

### Redis with Auth

```go
func setupHARedis(ctx context.Context) *Container {
    // Start Redis with authentication
    req := testcontainers.ContainerRequest{
        Image:        "redis:7-alpine",
        ExposedPorts: []string{"6379"},
        Cmd:          []string{"redis-server", "--requirepass", "password"},
    }
    // ...
}
```

## Troubleshooting

### "Replica set not initialized"

**Problem:** MongoDB replica set isn't ready.

**Solution:**
- Wait longer for initialization
- Check container logs for errors
- Verify replica set configuration

### "Authentication failed"

**Problem:** Can't connect with credentials.

**Solution:**
- Verify username and password
- Check if auth is enabled
- Ensure connection string is correct

### "Failover test failing"

**Problem:** Service doesn't handle failover correctly.

**Solution:**
- Increase wait times for failover
- Check connection pool settings
- Verify retry logic in code

### "Tests are slow"

**Problem:** HA tests take too long.

**Solution:**
- Use `testing.Short()` to skip when needed
- Parallelize independent tests
- Optimize container startup

## Best Practices

1. **Test realistic scenarios** - Use configurations similar to production
2. **Clean up containers** - Always remove test containers
3. **Wait for readiness** - Don't test until containers are fully ready
4. **Test both success and failure** - Verify happy paths and error cases
5. **Document assumptions** - Note what HA features are being tested

## Related Documentation

- [Testing Overview](overview.md) - All testing levels
- [Unit Tests](unit.md) - Testing individual components
- [Integration Tests](integration.md) - Testing with real databases
