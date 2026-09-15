# Unit Tests

This document explains how to write and run unit tests for the Payment Gateway.

## Overview

Unit tests verify individual components work correctly in isolation. They use mocks to replace external dependencies like RabbitMQ and Paddle.

Think of unit tests as **component tests** - each component is tested independently.

## Running Unit Tests

```bash
# Run all unit tests
make test

# Run with verbose output
go test -v ./...

# Run with coverage
make test-coverage

# Run specific package
go test -v ./internal/domain/...

# Run specific test
go test -v -run TestProcessWebhook ./internal/domain/...
```

## Test Structure

### Arrange-Act-Assert Pattern

Every test follows this pattern:

```go
func TestProcessWebhook_ValidSignature(t *testing.T) {
    // Arrange - Set up test data and mocks
    mockPublisher := &MockPublisher{}
    mockValidator := &MockValidator{}
    service := NewPaymentService(mockPublisher, mockValidator, nil, "secret")
    
    // Act - Call the method being tested
    err := service.ProcessWebhook(ctx, "valid_signature", body)
    
    // Assert - Verify the result
    assert.NoError(t, err)
    mockPublisher.AssertCalled(t, "Publish", ctx, body)
}
```

**Why this pattern?**
- Clear separation of concerns
- Easy to understand what's being tested
- Easy to debug when tests fail

## Test Files

### Service Tests

**Location:** `internal/domain/service_test.go`

**What they test:**
- ProcessWebhook with valid/invalid signatures
- ProcessInternalEvent with valid/invalid keys
- Event type extraction
- Error handling

**Example:**

```go
func TestProcessWebhook_ValidSignature(t *testing.T) {
    // Arrange
    mockPublisher := &MockPublisher{}
    mockValidator := &MockValidator{}
    mockValidator.On("Validate", "valid_sig", body, "secret").Return(true)
    mockPublisher.On("Publish", ctx, body).Return(nil)
    
    service := NewPaymentService(mockPublisher, mockValidator, nil, "secret")
    
    // Act
    err := service.ProcessWebhook(ctx, "valid_sig", body)
    
    // Assert
    assert.NoError(t, err)
    mockValidator.AssertCalled(t, "Validate", "valid_sig", body, "secret")
    mockPublisher.AssertCalled(t, "Publish", ctx, body)
}
```

### Handler Tests

**Location:** `internal/transport/http/handler_test.go`

**What they test:**
- HTTP request handling
- Response status codes
- Error responses
- Header validation

**Example:**

```go
func TestHandleWebhook_ValidSignature(t *testing.T) {
    // Arrange
    mockService := &MockService{}
    mockService.On("ProcessWebhook", ctx, "valid_sig", body).Return(nil)
    
    handler := NewHandler(HandlerConfig{
        Service: mockService,
        InternalKey: "test_key",
    })
    
    router := gin.New()
    handler.RegisterRoutes(router)
    
    // Act
    req := httptest.NewRequest("POST", "/webhook/paddle", bytes.NewBuffer(body))
    req.Header.Set("Paddle-Signature", "valid_sig")
    w := httptest.NewRecorder()
    
    router.ServeHTTP(w, req)
    
    // Assert
    assert.Equal(t, http.StatusOK, w.Code)
    assert.Contains(t, w.Body.String(), "queued")
}
```

### Config Tests

**Location:** `internal/config/config_test.go`

**What they test:**
- Configuration validation
- Environment variable parsing
- Default values
- Error handling

**Example:**

```go
func TestConfig_Validate_Valid(t *testing.T) {
    // Arrange
    cfg := &Config{
        EnvType:           "dev",
        WebhookSecret:     "whsec_test_secret_min_16",
        InternalAPIKey:    "test_internal_key_min_16",
        RabbitMQURL:       "amqp://guest:guest@rabbitmq:5672/",
        RabbitMQQueueType: "quorum",
        Port:              "8080",
    }
    
    // Act
    err := cfg.Validate()
    
    // Assert
    assert.NoError(t, err)
}
```

## Mocking

### Mock Interfaces

The gateway uses `testify/mock` for mocking interfaces:

```go
type MockPublisher struct {
    mock.Mock
}

func (m *MockPublisher) Publish(ctx context.Context, body []byte) error {
    args := m.Called(ctx, body)
    return args.Error(0)
}

func (m *MockPublisher) AssertCalled(t *testing.T, methodName string, args ...interface{}) {
    m.Called(t, methodName, args)
}
```

### Setting Up Mocks

```go
// Setup expectations
mockPublisher.On("Publish", ctx, body).Return(nil)
mockValidator.On("Validate", "sig", body, "secret").Return(true)

// Verify calls
mockPublisher.AssertCalled(t, "Publish", ctx, body)
mockPublisher.AssertNumberOfCalls(t, "Publish", 1)
```

### Mock Behaviors

```go
// Return nil (success)
mock.On("Publish", ctx, body).Return(nil)

// Return error
mock.On("Publish", ctx, body).Return(errors.New("connection failed"))

// Return specific value
mock.On("Validate", "sig", body, "secret").Return(true)

// Panic (for testing error handling)
mock.On("Publish", ctx, body).Panic("unexpected call")
```

## Test Helpers

### Generate Test Body

```go
func generateTestBody(eventType string) []byte {
    return []byte(fmt.Sprintf(`{
        "event_id": "evt_123",
        "event_type": "%s",
        "alert_name": "%s"
    }`, eventType, eventType))
}
```

### Generate Test Signature

```go
func generateTestSignature(secret string, body []byte, ts int64) string {
    message := fmt.Sprintf("%d:%s", ts, body)
    h := hmac.New(sha256.New, []byte(secret))
    h.Write([]byte(message))
    return fmt.Sprintf("ts=%d;h1=%x", ts, h.Sum(nil))
}
```

### Generate Valid Timestamp

```go
func generateValidTimestamp() int64 {
    return time.Now().Unix()
}
```

## Test Categories

### Happy Path Tests

Test the normal, expected behavior:

```go
func TestProcessWebhook_Success(t *testing.T) {
    // Test successful webhook processing
}

func TestProcessInternalEvent_Success(t *testing.T) {
    // Test successful internal event processing
}
```

### Error Path Tests

Test error handling:

```go
func TestProcessWebhook_InvalidSignature(t *testing.T) {
    // Test invalid signature handling
}

func TestProcessWebhook_RabbitMQDown(t *testing.T) {
    // Test RabbitMQ down scenario
}

func TestProcessWebhook_BodyTooLarge(t *testing.T) {
    // Test body size limit
}
```

### Edge Case Tests

Test boundary conditions:

```go
func TestProcessWebhook_EmptyBody(t *testing.T) {
    // Test empty body
}

func TestProcessWebhook_UnknownEventType(t *testing.T) {
    // Test unknown event type
}

func TestProcessWebhook_LegacyAlertName(t *testing.T) {
    // Test legacy alert_name field
}
```

## Coverage

### Checking Coverage

```bash
# Generate coverage report
go test -coverprofile=coverage.out ./...

# View coverage in terminal
go tool cover -func=coverage.out

# View coverage in browser
go tool cover -html=coverage.out
```

### Coverage Targets

| Component | Target | Why |
|-----------|--------|-----|
| Domain | 90%+ | Critical business logic |
| Transport | 80%+ | HTTP handling |
| Config | 80%+ | Configuration validation |
| Overall | 80%+ | Good baseline |

### Coverage Exclusions

- `cmd/gateway/main.go` - Bootstrap code
- `config/provider.go` - AWS-specific code
- `monitoring/monitoring.go` - Prometheus registration

## Running Tests

### Local Development

```bash
# Run all tests
make test

# Run with verbose output
go test -v ./...

# Run specific test
go test -v -run TestProcessWebhook ./internal/domain/...

# Run tests in parallel
go test -parallel 4 ./...
```

### CI/CD

```bash
# Run all tests with coverage
make test-coverage

# Run with race detector
go test -race ./...
```

### Docker

```bash
# Run tests in Docker
docker run --rm -v $(pwd):/app -w /app golang:1.21 go test ./...
```

## Debugging Tests

### Verbose Output

```bash
go test -v ./...
```

### Race Detector

```bash
go test -race ./...
```

### Test Coverage

```bash
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

### Print Statements

```go
func TestProcessWebhook(t *testing.T) {
    t.Logf("Body: %s", string(body))
    t.Logf("Signature: %s", signature)
    // ...
}
```

## Best Practices

### Test Naming

Use descriptive names:

```go
// Good
func TestProcessWebhook_ValidSignature_ReturnsNil(t *testing.T) {}
func TestProcessWebhook_InvalidSignature_ReturnsError(t *testing.T) {}

// Bad
func TestProcessWebhook1(t *testing.T) {}
func TestProcessWebhook2(t *testing.T) {}
```

### One Assertion Per Test

Each test should verify one thing:

```go
// Good
func TestProcessWebhook_ValidSignature_ReturnsNil(t *testing.T) {
    // Test only that valid signature returns nil
}

func TestProcessWebhook_ValidSignature_PublishesEvent(t *testing.T) {
    // Test only that valid signature publishes event
}

// Bad
func TestProcessWebhook_ValidSignature(t *testing.T) {
    // Tests too many things
}
```

### Independent Tests

Tests should not depend on each other:

```go
// Good - each test is independent
func TestProcessWebhook_ValidSignature(t *testing.T) { ... }
func TestProcessWebhook_InvalidSignature(t *testing.T) { ... }

// Bad - tests depend on execution order
var counter int
func TestProcessWebhook1(t *testing.T) { counter++ }
func TestProcessWebhook2(t *testing.T) { assert.Equal(t, 1, counter) }
```

### Clean Tests

Tests should be easy to read:

```go
func TestProcessWebhook_ValidSignature(t *testing.T) {
    // Arrange
    mockPublisher := &MockPublisher{}
    mockValidator := &MockValidator{}
    service := NewPaymentService(mockPublisher, mockValidator, nil, "secret")
    
    // Act
    err := service.ProcessWebhook(ctx, "valid_sig", body)
    
    // Assert
    assert.NoError(t, err)
}
```

## Related Documentation

- [Testing Overview](overview.md) - Testing strategy
- [Integration Tests](integration.md) - Integration testing
- [Load Tests](load.md) - Load testing
- [Architecture](../concepts/architecture.md) - Component structure
