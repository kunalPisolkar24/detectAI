# Testing Overview

This document explains how to test the Payment Gateway service.

## Overview

The gateway has four types of tests:

1. **Unit Tests** - Test individual components in isolation
2. **Integration Tests** - Test with real RabbitMQ
3. **HA Tests** - Test high availability with cluster
4. **Load Tests** - Test performance under load

Think of testing as a **safety net** - unit tests catch individual bugs, integration tests catch component interactions, and load tests catch performance issues.

## Test Commands

All test commands are wrapped with `make` for simplicity:

```bash
# Run unit tests
make test

# Run with coverage report
make test-coverage

# Run integration tests (needs Docker)
make test-integration

# Run HA integration (3-node quorum cluster)
make test-integration-ha

# Run load tests (k6)
make load-test
```

## Test Types

### Unit Tests

**What they test:** Individual components in isolation.

**When to run:** Every commit, during development.

**How to run:**

```bash
make test
```

**What they verify:**
- Service logic works correctly
- Validation rules are enforced
- Error handling is correct
- Metrics are recorded

See [Unit Tests](unit.md) for details.

### Integration Tests

**What they test:** End-to-end flow with real RabbitMQ.

**When to run:** Before deployment, when changing RabbitMQ code.

**How to run:**

```bash
make test-integration
```

**What they verify:**
- Messages are published to RabbitMQ
- Connection management works
- Health checks work correctly
- Error responses are correct

See [Integration Tests](integration.md) for details.

### HA Tests

**What they test:** High availability with 3-node RabbitMQ cluster.

**When to run:** When changing queue types, before production deployment.

**How to run:**

```bash
make test-integration-ha
```

**What they verify:**
- Quorum queues work correctly
- Node failure doesn't lose messages
- Classic vs quorum behavior
- DLQ works in cluster

See [Integration Tests](integration.md) for details.

### Load Tests

**What they test:** Performance under load.

**When to run:** Before deployment, when expecting high traffic.

**How to run:**

```bash
make load-test
```

**What they verify:**
- p95 latency < 500ms
- Error rate < 1%
- No memory leaks
- RabbitMQ stays stable

See [Load Tests](load.md) for details.

## Test Structure

```mermaid
graph TB
    subgraph "Test Types"
        Unit[Unit Tests]
        Integration[Integration Tests]
        HA[HA Tests]
        Load[Load Tests]
    end
    
    subgraph "Test Tools"
        GoTest[go test]
        Testcontainers[testcontainers-go]
        K6[k6]
        Mockery[mockery]
    end
    
    Unit --> GoTest
    Integration --> Testcontainers
    HA --> Testcontainers
    Load --> K6
    Unit --> Mockery
```

### Test Locations

| Test Type | Location | Run Command |
|-----------|----------|-------------|
| Unit | `internal/*/` | `make test` |
| Integration | `test/integration/` | `make test-integration` |
| HA | `test/integration/` | `make test-integration-ha` |
| Load | `test/load/` | `make load-test` |

## Test Configuration

### Environment Variables

| Variable | Default | Test Value | Why |
|----------|---------|------------|-----|
| `ENV_TYPE` | `dev` | `dev` | Use local config |
| `RABBITMQ_URL` | `amqp://guest:guest@rabbitmq:5672/` | Testcontainer URL | Real RabbitMQ |
| `PADDLE_WEBHOOK_SECRET` | *(required)* | `test_secret` | Test HMAC |
| `INTERNAL_API_KEY` | *(required)* | `test_internal_key` | Test API key |

### Test Dependencies

| Dependency | Purpose | Required |
|------------|---------|----------|
| Go 1.21+ | Run tests | Yes |
| Docker | Integration tests | Yes |
| RabbitMQ | Integration tests | Yes (testcontainers) |
| k6 | Load tests | Yes (Docker) |

## Writing Tests

### Test Naming Convention

```go
func TestProcessWebhook_ValidSignature(t *testing.T) { ... }
func TestProcessWebhook_InvalidSignature(t *testing.T) { ... }
func TestProcessWebhook_RabbitMQDown(t *testing.T) { ... }
```

**Pattern:** `Test[Component]_[Scenario]`

### Test Structure

```go
func TestProcessWebhook_ValidSignature(t *testing.T) {
    // Arrange
    mockPublisher := &MockPublisher{}
    mockValidator := &MockValidator{}
    service := NewPaymentService(mockPublisher, mockValidator, nil, "secret")
    
    // Act
    err := service.ProcessWebhook(ctx, "valid_signature", body)
    
    // Assert
    assert.NoError(t, err)
    mockPublisher.AssertCalled(t, "Publish", ctx, body)
}
```

**Pattern:** Arrange -> Act -> Assert

### Mocking

The gateway uses `testify/mock` for mocking:

```go
type MockPublisher struct {
    mock.Mock
}

func (m *MockPublisher) Publish(ctx context.Context, body []byte) error {
    args := m.Called(ctx, body)
    return args.Error(0)
}
```

See [Unit Tests](unit.md) for more examples.

## Test Coverage

### Checking Coverage

```bash
# Generate coverage report
make test-coverage

# View coverage in browser
go tool cover -html=coverage.out
```

### Coverage Targets

| Component | Target | Why |
|-----------|--------|-----|
| Domain | 90%+ | Critical business logic |
| Transport | 80%+ | HTTP handling |
| Infrastructure | 70%+ | External integrations |
| Overall | 80%+ | Good baseline |

### Coverage Exclusions

- `cmd/gateway/main.go` - Bootstrap code
- `config/provider.go` - AWS-specific code
- `monitoring/monitoring.go` - Prometheus registration

## Continuous Integration

### CI Pipeline

```mermaid
graph LR
    Commit[Git Commit] --> Unit[Unit Tests]
    Unit --> Integration[Integration Tests]
    Integration --> HA[HA Tests]
    HA --> Load[Load Tests]
    Load --> Deploy[Deploy]
```

### CI Commands

```bash
# Unit tests (always run)
make test

# Integration tests (on PR)
make test-integration

# HA tests (on release)
make test-integration-ha

# Load tests (before deploy)
make load-test
```

## Test Data

### Mock Data

The gateway uses mock data for unit tests:

```go
var testBody = []byte(`{
    "event_id": "evt_123",
    "event_type": "subscription.updated",
    "alert_name": "subscription_updated"
}`)
```

### Test Signatures

For Paddle webhook tests:

```go
func generateTestSignature(secret string, body []byte, ts int64) string {
    message := fmt.Sprintf("%d:%s", ts, body)
    h := hmac.New(sha256.New, []byte(secret))
    h.Write([]byte(message))
    return fmt.Sprintf("ts=%d;h1=%x", ts, h.Sum(nil))
}
```

## Troubleshooting Tests

### Unit Tests Fail

**Possible causes:**
1. **Mock not set up** - Missing mock expectations
2. **Wrong assertions** - Using wrong assert function
3. **Race condition** - Concurrent test issues

**What to do:**
1. Check mock setup: `mock.AssertExpectations(t)`
2. Use `-v` flag: `go test -v ./...`
3. Check for race conditions: `go test -race ./...`

### Integration Tests Fail

**Possible causes:**
1. **Docker not running** - Integration tests need Docker
2. **Port conflict** - Another process using port 5672
3. **RabbitMQ slow** - Testcontainer startup slow

**What to do:**
1. Check Docker: `docker ps`
2. Check ports: `lsof -i :5672`
3. Increase timeout: `go test -timeout 300s ./...`

### Load Tests Fail

**Possible causes:**
1. **High latency** - p95 > 500ms
2. **High error rate** - > 1%
3. **Memory leak** - Memory growing over time

**What to do:**
1. Check gateway metrics: `curl http://localhost:8080/metrics`
2. Check RabbitMQ: `http://localhost:15672`
3. Profile gateway: `go tool pprof`

## Related Documentation

- [Unit Tests](unit.md) - Unit testing details
- [Integration Tests](integration.md) - Integration testing details
- [Load Tests](load.md) - Load testing details
- [Observability](../operations/observability.md) - Monitoring tests
