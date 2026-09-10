# Unit Tests

This document explains how to write and run unit tests for the Chats service.

## What are Unit Tests?

Unit tests check individual parts of the code in isolation. They're like checking each brick in a wall to make sure it's strong before building the wall.

**Key characteristics:**
- Test one function or method at a time
- Use fake databases (mocks) instead of real ones
- Run quickly (seconds)
- Don't require Docker

## Why Unit Tests Matter

| Benefit | Explanation |
|---------|-------------|
| **Fast feedback** | Know immediately if your change broke something |
| **Isolation** | Test business logic without external dependencies |
| **Documentation** | Tests show how code should be used |
| **Refactoring safety** | Change code confidently knowing tests will catch mistakes |

## Running Unit Tests

```bash
# Run all unit tests
make test

# Run with coverage report
make test-coverage

# Run specific test file
go test ./internal/core/usecase/chat_service_test.go

# Run specific test function
go test -run TestCreateChat ./internal/core/usecase/
```

## Test Structure

### Directory Layout

```
chats/
├── internal/
│   ├── core/
│   │   └── usecase/
│   │       └── chat_service_test.go    # Business logic tests
│   └── adapters/
│       └── grpc/
│           └── handler_test.go         # API handler tests
├── internal/
│   └── mocks/                          # Test doubles
│       ├── chat_service.go
│       ├── chat_repository.go
│       └── ...
```

### Test File Naming

- Test files end with `_test.go`
- Same package as the code they test
- One test file per source file

## Writing Unit Tests

### Basic Test Structure

```go
func TestFunctionName(t *testing.T) {
    // Arrange: Set up test data and dependencies
    
    // Act: Call the function being tested
    
    // Assert: Check the result
}
```

### Example: Testing Business Logic

```go
func TestCreateChat_WithTitle(t *testing.T) {
    // Arrange
    mockRepo := new(MockChatRepository)
    mockCache := new(MockCacheRepository)
    mockStream := new(MockStreamRepository)
    
    service := NewChatService(mockRepo, mockCache, mockStream)
    
    // Act
    session, err := service.CreateSession("user123", "My Chat")
    
    // Assert
    assert.NoError(t, err)
    assert.Equal(t, "My Chat", session.Title)
    assert.Equal(t, "user123", session.UserID)
    mockRepo.AssertCalled(t, "CreateSession", mock.Anything)
}
```

### Example: Testing Error Cases

```go
func TestCreateChat_EmptyTitle(t *testing.T) {
    // Arrange
    mockRepo := new(MockChatRepository)
    service := NewChatService(mockRepo, nil, nil)
    
    // Act
    _, err := service.CreateSession("user123", "")
    
    // Assert
    assert.Error(t, err)
    assert.Contains(t, err.Error(), "title is required")
    mockRepo.AssertNotCalled(t, "CreateSession")
}
```

### Example: Testing with Mocks

```go
func TestGetHistory_CacheHit(t *testing.T) {
    // Arrange
    mockCache := new(MockCacheRepository)
    mockRepo := new(MockChatRepository)
    
    // Set up cache to return messages
    mockCache.On("GetRecentMessages", "chat123").Return([]Message{
        {ID: "msg1", Content: "Hello"},
    }, nil)
    
    service := NewChatService(mockRepo, mockCache, nil)
    
    // Act
    messages, err := service.GetHistory("chat123", "user123", 1, 20)
    
    // Assert
    assert.NoError(t, err)
    assert.Len(t, messages, 1)
    mockCache.AssertCalled(t, "GetRecentMessages", "chat123")
}
```

## What to Test

### Business Logic (usecase/)

| What | Example Tests |
|------|---------------|
| **Chat creation** | Valid title, empty title, title too long |
| **Message saving** | Valid message, missing fields, invalid role |
| **History retrieval** | Cache hit, cache miss, pagination |
| **Authorization** | Owner access, non-owner rejection |
| **Validation** | All input rules |

### API Handler (adapters/grpc/)

| What | Example Tests |
|------|---------------|
| **Request parsing** | Valid request, missing fields, invalid JSON |
| **Authentication** | Header present, missing header, mismatch |
| **Error mapping** | Domain errors to gRPC codes |
| **Response format** | Correct structure, field types |

### Repositories

| What | Example Tests |
|------|---------------|
| **Database operations** | Create, read, update, delete |
| **Error handling** | Connection failures, timeouts |
| **Edge cases** | Empty results, large datasets |

## Mocks

Mocks are fake implementations used in tests. They let you test code without real databases.

### Using Mocks

```go
// Create mock
mockRepo := new(MockChatRepository)

// Set up expectations
mockRepo.On("CreateSession", mock.Anything).Return(&ChatSession{
    ID: "new-chat",
}, nil)

// Call your code
session, err := service.CreateSession("user123", "Test")

// Verify expectations were met
mockRepo.AssertCalled(t, "CreateSession", mock.Anything)
mockRepo.AssertNumberOfCalls(t, "CreateSession", 1)
```

### Available Mocks

| Mock | Location | Purpose |
|------|----------|---------|
| `MockChatService` | `internal/mocks/` | Business logic |
| `MockChatRepository` | `internal/mocks/` | Database operations |
| `MockCacheRepository` | `internal/mocks/` | Cache operations |
| `MockStreamRepository` | `internal/mocks/` | Stream operations |

## Test Coverage

Coverage shows what percentage of your code is tested.

```bash
# Generate coverage report
make test-coverage

# View in browser
go tool cover -html=coverage.out

# View summary
go tool cover -func=coverage.out
```

### Coverage Goals

| Code Type | Target | Why |
|-----------|--------|-----|
| Business logic | > 80% | Core functionality |
| API handlers | > 70% | User-facing code |
| Database adapters | > 60% | Infrastructure code |
| Utilities | > 50% | Helper functions |

## Common Patterns

### Table-Driven Tests

```go
func TestValidateMessage(t *testing.T) {
    tests := []struct {
        name    string
        message Message
        wantErr bool
    }{
        {
            name:    "valid message",
            message: Message{Content: "Hello", Role: "user"},
            wantErr: false,
        },
        {
            name:    "empty content",
            message: Message{Content: "", Role: "user"},
            wantErr: true,
        },
        {
            name:    "invalid role",
            message: Message{Content: "Hello", Role: "invalid"},
            wantErr: true,
        },
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            err := validateMessage(tt.message)
            if (err != nil) != tt.wantErr {
                t.Errorf("validateMessage() error = %v, wantErr %v", err, tt.wantErr)
            }
        })
    }
}
```

### Setup and Teardown

```go
func TestMain(m *testing.M) {
    // Setup: Run before all tests
    setup()
    
    // Run tests
    code := m.Run()
    
    // Teardown: Run after all tests
    teardown()
    
    os.Exit(code)
}
```

## Troubleshooting

### "Mock not called"

**Problem:** Test fails because mock wasn't called.

**Solution:** Check if your code actually calls the mock. Add debug prints or check the logic.

### "Unexpected call"

**Problem:** Mock receives a call it wasn't expecting.

**Solution:** Set up the mock to expect this call, or check if your code is calling the right function.

### "Tests are flaky"

**Problem:** Tests sometimes pass, sometimes fail.

**Solution:** Check for:
- Race conditions
- Shared state between tests
- Time-dependent code
- Network calls (should use mocks)

### "Coverage is low"

**Problem:** Not enough code is tested.

**Solution:** 
- Add tests for uncovered paths
- Test error cases
- Test edge cases

## Best Practices

1. **Test one thing at a time** - Each test should verify one behavior
2. **Use descriptive names** - Test names should explain what they test
3. **Keep tests independent** - Tests shouldn't depend on each other
4. **Clean up after tests** - Don't leave test data around
5. **Run tests frequently** - Don't wait until the end to test

## Related Documentation

- [Testing Overview](overview.md) - All testing levels
- [Integration Tests](integration.md) - Testing with real databases
- [Architecture](../concepts/architecture.md) - How components are structured
