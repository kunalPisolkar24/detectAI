# Testing

This document explains how to test the Chats service. Testing ensures the service works correctly and catches bugs before they reach users.

## Why Test?

Testing helps you:
- **Catch bugs early** - Find problems before users do
- **Ensure quality** - Verify features work as expected
- **Enable changes** - Safely modify code knowing tests will catch mistakes
- **Document behavior** - Tests show how the service should work

## Testing Levels

The Chats service has three levels of testing, each with different tradeoffs:

### Unit Tests

**What they are:** Tests that check individual parts of the code in isolation.

**When to use:** Every time you change code.

**Speed:** Fast (seconds).

**Dependencies:** None (uses fake databases).

```bash
# Run unit tests
make test

# Run with coverage report
make test-coverage
```

**Example:** Testing that a message validation function rejects messages that are too long.

### Integration Tests

**What they are:** Tests that check multiple parts working together with real databases.

**When to use:** Before committing code.

**Speed:** Medium (minutes).

**Dependencies:** Docker (for real databases).

```bash
# Run integration tests
make test-integration
```

**Example:** Testing that saving a message and retrieving it works end-to-end.

### Sharded Cluster Tests

**What they are:** Tests that check MongoDB sharding works correctly — queries route to the right shard, data is isolated between chats, and chunk distribution spans multiple shards.

**When to use:** When changing database queries, repository code, or sharding configuration.

**Speed:** Slower (60-90s per test for cluster bootstrap).

**Dependencies:** Docker (spins up a real 5-container sharded cluster).

```bash
# Run sharded cluster tests
make test-sharded
```

**Example:** Testing that a query for chat A never accidentally returns messages from chat B when data is spread across shards.

See [Sharded Cluster Tests](sharded.md) for a detailed guide.

### HA Tests

**What they are:** Tests that check the service works with high-availability setups (replica sets, authentication, failover).

**When to use:** Before deploying to production.

**Speed:** Slower (minutes).

**Dependencies:** Docker (for HA databases).

```bash
# Run HA tests
make test-ha
```

**Example:** Testing that the service handles database failover correctly.

## Choosing Which Tests to Run

| Change Type | Run These Tests |
|-------------|-----------------|
| Small bug fix | Unit tests |
| New feature | Unit + Integration |
| Configuration change | Unit + Integration |
| Database query or repository change | Unit + Integration + Sharded |
| Production deployment | All tests |
| Quick check | Unit tests |

## Test Structure

```
chats/
├── internal/
│   ├── core/
│   │   └── usecase/
│   │       └── chat_service_test.go    # Unit tests for business logic
│   ├── adapters/
│   │   ├── grpc/
│   │   │   └── handler_test.go         # Unit tests for API handler
│   │   ├── mongo/
│   │   │   ├── repository_test.go      # Integration tests for MongoDB
│   │   │   ├── ha_test.go              # HA tests (replica set)
│   │   │   └── sharded_test.go         # Sharded cluster tests
│   │   ├── worker/
│   │   │   └── sharded_test.go         # Worker E2E against sharded cluster
│   │   └── redis/
│   │       └── ha_test.go              # Redis HA tests
│   └── testutil/
│       ├── containers_sharded.go       # 5-container sharded cluster fixture
│       └── ...
├── tests/
│   ├── integration/
│   │   └── chat_flow_test.go          # Integration tests
│   └── load/
│       └── README.md                   # Load test documentation
└── docs/
    └── testing/
        ├── overview.md                 # This file
        ├── unit.md                     # Unit test details
        ├── integration.md              # Integration test details
        ├── sharded.md                  # Sharded cluster test details
        └── ha.md                       # HA test details
```

## Writing Tests

### Unit Test Example

```go
func TestCreateChat(t *testing.T) {
    // Arrange: Set up test data
    service := NewChatService(mockRepo, mockCache, mockStream)
    
    // Act: Call the function being tested
    result, err := service.CreateSession("user123", "Test Chat")
    
    // Assert: Check the result
    assert.NoError(t, err)
    assert.Equal(t, "Test Chat", result.Title)
}
```

### Integration Test Example

```go
func TestSaveAndRetrieveMessage(t *testing.T) {
    // Arrange: Set up real databases
    service := setupTestService()
    
    // Act: Save a message
    msg, err := service.ProcessMessage(Message{
        ChatID:  "test-chat",
        UserID:  "user123",
        Content: "Hello",
    })
    
    // Assert: Message was saved
    assert.NoError(t, err)
    assert.NotEmpty(t, msg.ID)
    
    // Act: Retrieve history
    messages, err := service.GetHistory("test-chat", "user123", 1, 20)
    
    // Assert: Message appears in history
    assert.NoError(t, err)
    assert.Len(t, messages, 1)
}
```

## Test Coverage

Coverage shows what percentage of your code is tested.

```bash
# Generate coverage report
make test-coverage

# View coverage in browser
go tool cover -html=coverage.out
```

### Coverage Goals

| Code Type | Target Coverage |
|-----------|-----------------|
| Business logic | > 80% |
| API handlers | > 70% |
| Database adapters | > 60% |
| Utilities | > 50% |

## Load Testing

Load testing checks how the service performs under heavy traffic.

```bash
# Run smoke test (quick check)
make load-test SCENARIO=smoke VUS=1 DURATION=10s

# Run load test (realistic traffic)
make load-test SCENARIO=load VUS=10 DURATION=2m RPS=50

# Stop load test
make load-down
```

### Load Test Scenarios

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| `smoke` | 1 | 10 seconds | Quick sanity check |
| `load` | 10 | 2 minutes | Realistic traffic |
| `stress` | 50 | 5 minutes | Find breaking point |

## Common Testing Issues

### "Docker not running"

**Problem:** Integration tests fail because Docker isn't running.

**Solution:** Start Docker Desktop or run `dockerd`.

### "Port already in use"

**Problem:** Tests fail because another process is using the port.

**Solution:** Stop the other process or use a different port.

### "Tests are slow"

**Problem:** Tests take too long to run.

**Solution:** 
- Run only unit tests for quick feedback
- Use test tags to run specific tests
- Check if tests are doing unnecessary work

### "Flaky tests"

**Problem:** Tests sometimes pass, sometimes fail.

**Solution:**
- Check for race conditions
- Ensure tests clean up after themselves
- Use proper test isolation

## Best Practices

1. **Write tests before fixing bugs** - Ensure the bug exists, then write a test that catches it
2. **Keep tests simple** - Each test should test one thing
3. **Use descriptive names** - Test names should explain what they test
4. **Clean up after tests** - Don't leave test data in databases
5. **Run tests frequently** - Don't wait until the end to test
6. **Run sharded tests when touching repository code** - They catch routing and isolation issues that standalone MongoDB tests cannot

## Related Documentation

- [Architecture](../concepts/architecture.md) - How components are structured
- [Configuration](../getting-started/configuration.md) - Test environment settings
- [Observability](../operations/observability.md) - Monitor test performance
- [Sharded Cluster Tests](sharded.md) - Detailed guide for MongoDB sharding tests
