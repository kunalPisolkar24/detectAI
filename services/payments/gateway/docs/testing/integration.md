# Integration Tests

This document explains how to write and run integration tests for the Payment Gateway.

## Overview

Integration tests verify the gateway works correctly with real RabbitMQ. They use testcontainers to spin up Docker containers automatically.

Think of integration tests as **end-to-end tests** - they verify the entire flow from request to RabbitMQ.

## Running Integration Tests

```bash
# Run integration tests
make test-integration

# Run with verbose output
go test -v -tags=integration ./test/integration/...

# Run specific test
go test -v -tags=integration -run TestIntegration ./test/integration/...
```

## Prerequisites

- **Docker** running
- **Go 1.21+**
- **Internet connection** (to pull RabbitMQ image)

## Test Structure

### Testcontainers

Integration tests use testcontainers to spin up RabbitMQ:

```go
func TestIntegration(t *testing.T) {
    // Start RabbitMQ container
    ctx := context.Background()
    rabbitmqContainer, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Image:        "rabbitmq:3.13-management-alpine",
            ExposedPorts: []string{"5672/tcp"},
            WaitingFor:   wait.ForListeningPort("5672/tcp"),
        },
        Started: true,
    })
    if err != nil {
        t.Fatal(err)
    }
    defer rabbitmqContainer.Terminate(ctx)
    
    // Get RabbitMQ URL
    host, _ := rabbitmqContainer.Host(ctx)
    port, _ := rabbitmqContainer.MappedPort(ctx, "5672")
    rabbitmqURL := fmt.Sprintf("amqp://guest:guest@%s:%s/", host, port.Port())
    
    // Run tests with real RabbitMQ
    // ...
}
```

**Why testcontainers?**
- Tests use real RabbitMQ (not mocks)
- Containers are automatically cleaned up
- Tests are isolated (no shared state)
- Works in CI/CD (no external dependencies)

### Test Categories

#### Happy Path Tests

Test successful message publishing:

```go
func TestIntegration_PublishSuccess(t *testing.T) {
    // Arrange
    producer := rabbitmq.NewRabbitMQProducer(rabbitmqURL, "test_queue", "quorum", log, monitor)
    defer producer.Close()
    
    // Act
    err := producer.Publish(ctx, body)
    
    // Assert
    assert.NoError(t, err)
    
    // Verify message was published
    // (consume from queue and check message)
}
```

#### Error Handling Tests

Test error scenarios:

```go
func TestIntegration_RabbitMQDown(t *testing.T) {
    // Arrange
    producer := rabbitmq.NewRabbitMQProducer("amqp://guest:guest@localhost:9999/", "test_queue", "quorum", log, monitor)
    
    // Act
    err := producer.Publish(ctx, body)
    
    // Assert
    assert.Error(t, err)
    assert.True(t, errors.Is(err, ports.ErrNotConnected))
}
```

#### Health Check Tests

Test health endpoints:

```go
func TestIntegration_ReadinessCheck(t *testing.T) {
    // Arrange
    handler := setupTestHandler(rabbitmqURL)
    
    // Act
    req := httptest.NewRequest("GET", "/readyz", nil)
    w := httptest.NewRecorder()
    handler.ServeHTTP(w, req)
    
    // Assert
    assert.Equal(t, http.StatusOK, w.Code)
}
```

## Test Files

### Integration Test

**Location:** `test/integration/integration_test.go`

**What it tests:**
- Message publishing to RabbitMQ
- Connection management
- Health checks
- Error responses

### HA Integration Test

**Location:** `test/integration/ha_cluster.go`

**What it tests:**
- 3-node RabbitMQ cluster
- Quorum queue behavior
- Node failure recovery
- DLQ in cluster

## Test Scenarios

### Message Publishing

```go
func TestIntegration_MessagePublishing(t *testing.T) {
    // Test that messages are published to RabbitMQ
    // Test that publisher confirms work
    // Test that persistent messages survive restart
}
```

### Connection Management

```go
func TestIntegration_ConnectionReconnect(t *testing.T) {
    // Test that connection reconnects after failure
    // Test that reconnection has jitter
    // Test that status is updated correctly
}
```

### Health Checks

```go
func TestIntegration_HealthChecks(t *testing.T) {
    // Test /healthz always returns 200
    // Test /readyz returns 200 when connected
    // Test /readyz returns 503 when disconnected
}
```

### Error Handling

```go
func TestIntegration_ErrorHandling(t *testing.T) {
    // Test 401 for invalid signature
    // Test 400 for body too large
    // Test 503 when RabbitMQ down
    // Test 500 for publish failure
}
```

## Test Helpers

### Setup Test Environment

```go
func setupTestEnvironment(t *testing.T) (string, func()) {
    ctx := context.Background()
    
    // Start RabbitMQ container
    container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
        ContainerRequest: testcontainers.ContainerRequest{
            Image:        "rabbitmq:3.13-management-alpine",
            ExposedPorts: []string{"5672/tcp"},
            WaitingFor:   wait.ForListeningPort("5672/tcp"),
        },
        Started: true,
    })
    if err != nil {
        t.Fatal(err)
    }
    
    // Get connection URL
    host, _ := container.Host(ctx)
    port, _ := container.MappedPort(ctx, "5672")
    url := fmt.Sprintf("amqp://guest:guest@%s:%s/", host, port.Port())
    
    // Return cleanup function
    return url, func() {
        container.Terminate(ctx)
    }
}
```

### Setup Test Handler

```go
func setupTestHandler(rabbitmqURL string) *gin.Engine {
    // Create real dependencies
    producer := rabbitmq.NewRabbitMQProducer(rabbitmqURL, "test_queue", "quorum", log, monitor)
    validator := paddle.NewValidator()
    service := application.NewPaymentService(producer, validator, monitor, "test_secret")
    handler := http.NewHandler(http.HandlerConfig{
        Service:     service,
        Health:      producer,
        Metrics:     monitor,
        InternalKey: "test_internal_key",
        Logger:      log,
    })
    
    // Setup router
    router := gin.New()
    handler.RegisterRoutes(router)
    return router
}
```

## HA Integration Tests

### 3-Node Cluster

The HA tests spin up a 3-node RabbitMQ cluster:

```go
func TestHA_QuorumPublishConsume(t *testing.T) {
    // Arrange
    cluster := setup3NodeCluster(t)
    defer cluster.Terminate()
    
    // Act
    err := cluster.Producer.Publish(ctx, body)
    
    // Assert
    assert.NoError(t, err)
    
    // Consume and verify
    msg, err := cluster.Consumer.Consume()
    assert.NoError(t, err)
    assert.Equal(t, body, msg.Body)
}
```

### Node Failure Recovery

```go
func TestHA_SingleNodeKill(t *testing.T) {
    // Arrange
    cluster := setup3NodeCluster(t)
    defer cluster.Terminate()
    
    // Publish messages
    for i := 0; i < 20; i++ {
        err := cluster.Producer.Publish(ctx, body)
        assert.NoError(t, err)
    }
    
    // Kill one node
    cluster.KillNode(1)
    
    // Wait for recovery
    time.Sleep(5 * time.Second)
    
    // Publish more messages
    for i := 0; i < 20; i++ {
        err := cluster.Producer.Publish(ctx, body)
        assert.NoError(t, err)
    }
    
    // Verify all messages were received
    messages := cluster.ConsumeAll()
    assert.Equal(t, 40, len(messages))
}
```

### Classic vs Quorum

```go
func TestHA_ClassicVsQuorum(t *testing.T) {
    // Test that classic queues don't work in quorum cluster
    // Test that quorum queues work correctly
    // Test 406 error when mismatch
}
```

## Running Tests

### Local Development

```bash
# Run integration tests
make test-integration

# Run HA tests
make test-integration-ha

# Run with verbose output
go test -v -tags=integration ./test/integration/...

# Run specific test
go test -v -tags=integration -run TestIntegration_PublishSuccess ./test/integration/...
```

### CI/CD

```bash
# Run all integration tests
make test-integration

# Run HA tests (on release)
make test-integration-ha

# Run with timeout
go test -v -tags=integration -timeout=300s ./test/integration/...
```

### Docker

```bash
# Run integration tests in Docker
docker run --rm -v $(pwd):/app -w /app -v /var/run/docker.sock:/var/run/docker.sock golang:1.21 go test -tags=integration ./test/integration/...
```

## Debugging Tests

### Verbose Output

```bash
go test -v -tags=integration ./test/integration/...
```

### Docker Logs

```bash
# Check RabbitMQ logs
docker logs <container_id>

# Check gateway logs
make gateway-logs
```

### Test Output

```go
func TestIntegration_PublishSuccess(t *testing.T) {
    t.Logf("RabbitMQ URL: %s", rabbitmqURL)
    t.Logf("Body: %s", string(body))
    // ...
}
```

## Troubleshooting

### Docker Not Running

**Error:** `Cannot connect to the Docker daemon`

**Solution:**
```bash
# Start Docker
sudo systemctl start docker

# Or on macOS
open -a Docker
```

### Port Conflict

**Error:** `port is already allocated`

**Solution:**
```bash
# Find process using port
lsof -i :5672

# Kill process
kill <PID>

# Or use different port
go test -tags=integration -rabbitmq-port=5673 ./test/integration/...
```

### RabbitMQ Slow Startup

**Error:** `timeout waiting for port`

**Solution:**
```go
// Increase timeout
WaitingFor: wait.ForListeningPort("5672/tcp").WithStartupTimeout(60 * time.Second),
```

### Container Cleanup

**Error:** `container already exists`

**Solution:**
```bash
# Clean up old containers
docker rm -f $(docker ps -aq --filter ancestor=rabbitmq:3.13-management-alpine)
```

## Best Practices

### Test Isolation

Each test should be independent:

```go
func TestIntegration_PublishSuccess(t *testing.T) {
    // Create fresh producer for each test
    producer := rabbitmq.NewRabbitMQProducer(rabbitmqURL, "test_queue", "quorum", log, monitor)
    defer producer.Close()
    
    // ...
}
```

### Cleanup

Always clean up resources:

```go
func TestIntegration(t *testing.T) {
    container, err := setupTestEnvironment(t)
    if err != nil {
        t.Fatal(err)
    }
    defer container.Terminate(context.Background()) // Cleanup
}
```

### Timeouts

Use appropriate timeouts:

```go
// Short timeout for unit-like integration tests
go test -tags=integration -timeout=60s ./test/integration/...

// Long timeout for HA tests
go test -tags=ha_integration -timeout=600s ./test/integration/... -run TestHA
```

## Related Documentation

- [Testing Overview](overview.md) - Testing strategy
- [Unit Tests](unit.md) - Unit testing
- [Load Tests](load.md) - Load testing
- [Message Delivery](../concepts/message-delivery.md) - RabbitMQ details
