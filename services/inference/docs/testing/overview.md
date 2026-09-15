# Testing

This document explains how to test the Inference service. Testing ensures the service works correctly and catches bugs before they reach users.

## Why Test?

Testing helps you:
- **Catch bugs early** - Find problems before users do
- **Ensure quality** - Verify features work as expected
- **Enable changes** - Safely modify code knowing tests will catch mistakes
- **Document behavior** - Tests show how the service should work

## Testing Levels

The Inference service has three levels of testing, each with different tradeoffs:

### Unit Tests

**What they are:** Tests that check individual parts of the code in isolation.

**When to use:** Every time you change code.

**Speed:** Fast (seconds).

**Dependencies:** None (uses fake models).

```bash
# Run unit tests
make test

# Run with coverage report
make test-coverage
```

**Example:** Testing that text validation rejects empty text.

### Integration Tests

**What they are:** Tests that check multiple parts working together with real models.

**When to use:** Before committing code.

**Speed:** Medium (minutes).

**Dependencies:** Model files (downloaded from HuggingFace).

```bash
# Run integration tests
make test-integration
```

**Example:** Testing that the complete analysis pipeline works end-to-end.

### Load Tests

**What they are:** Tests that check how the service performs under heavy traffic.

**When to use:** Before deploying to production.

**Speed:** Slower (minutes to hours).

**Dependencies:** Docker (for isolated test environment).

```bash
# Run smoke test (quick check)
make load-test SCENARIO=smoke GPU=0

# Run load test (realistic traffic)
make load-test SCENARIO=detect GPU=0 VUS=20

# Run soak test (long duration)
make load-test SCENARIO=soak GPU=0 VUS=2 DURATION=30m
```

**Example:** Testing that the service handles 100 concurrent requests without errors.

## Choosing Which Tests to Run

| Change Type | Run These Tests |
|-------------|-----------------|
| Small bug fix | Unit tests |
| New feature | Unit + Integration |
| Configuration change | Unit + Integration |
| Model changes | Unit + Integration + Load |
| Production deployment | All tests |
| Quick check | Unit tests |

## Test Structure

### Directory Layout

```
inference/
├── tests/
│   ├── unit/
│   │   ├── domain/
│   │   │   └── test_exceptions.py      # Domain model tests
│   │   ├── application/
│   │   │   └── test_document_analysis.py # Business logic tests
│   │   └── adapters/
│   │       ├── inbound/grpc/
│   │       │   ├── test_interceptors.py  # Auth tests
│   │       │   ├── test_servicer.py      # API handler tests
│   │       │   └── test_server.py        # Server tests
│   │       └── outbound/inference/
│   │           ├── test_batcher.py       # Batching tests
│   │           ├── test_engines.py       # Model engine tests
│   │           └── test_loader.py        # Model loading tests
│   └── integration/
│       ├── test_pipeline.py              # End-to-end tests
│       ├── test_observability.py         # Metrics tests
│       └── test_concurrency.py           # Concurrency tests
├── load/
│   ├── scenarios/                        # Load test scenarios
│   ├── lib/                              # Load test helpers
│   └── scripts/                          # Token generation
└── docs/
    └── testing/
        └── overview.md                   # This file
```

## Writing Tests

### Unit Test Example

```python
import pytest
from src.application.services.validation import InputValidator
from src.domain.exceptions import InvalidInputError

def test_validate_valid_text():
    """Test that valid text passes validation."""
    validator = InputValidator(max_text_chars=50000)
    result = validator.validate("Hello, world!")
    assert result == "Hello, world!"

def test_validate_empty_text():
    """Test that empty text raises error."""
    validator = InputValidator(max_text_chars=50000)
    with pytest.raises(InvalidInputError):
        validator.validate("")

def test_validate_too_long():
    """Test that text exceeding max length raises error."""
    validator = InputValidator(max_text_chars=100)
    with pytest.raises(InvalidInputError):
        validator.validate("a" * 101)
```

### Integration Test Example

```python
import pytest
from src.infrastructure.composition.container import build_analysis_service

@pytest.mark.integration
async def test_analyze_short_text():
    """Test complete analysis pipeline with short text."""
    # Setup
    service, _ = await build_analysis_service(settings, telemetry, executors)
    
    # Act
    result = await service.analyze("Hello, world!", "spark")
    
    # Assert
    assert 0.0 <= result.ai_probability <= 1.0
    assert result.total_chunks > 0
    assert result.total_chars > 0
```

## Test Coverage

Coverage shows what percentage of your code is tested.

```bash
# Generate coverage report
make test-coverage

# View coverage in browser
open htmlcov/index.html
```

### Coverage Goals

| Code Type | Target Coverage |
|-----------|-----------------|
| Business logic | > 80% |
| API handlers | > 70% |
| Adapters | > 60% |
| Utilities | > 50% |

## Load Testing

Load testing checks how the service performs under heavy traffic.

### Load Test Scenarios

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| `smoke` | 1 | 1 iteration | Quick sanity check |
| `detect` | 20-100 | 2 minutes | Realistic unary traffic |
| `analyze` | 6-8 | 5 minutes | Streaming traffic |
| `soak` | 2 | 30 minutes | Long-running stability |

### Running Load Tests

```bash
# Smoke test (always run before deploy)
make load-test SCENARIO=smoke GPU=0

# Detect test (realistic traffic)
make load-test SCENARIO=detect GPU=0 VUS=20 STAGES="30s:5,1m:10,30s:0"

# Analyze test (streaming)
make load-test SCENARIO=analyze GPU=0 VUS=8 DURATION=10m

# Soak test (overnight)
make load-test SCENARIO=soak GPU=0 VUS=2 DURATION=30m
```

### Load Test Thresholds

| Metric | smoke | detect | analyze | soak |
|--------|-------|--------|---------|------|
| p95 latency | - | <1500ms | <5000ms | <7000ms |
| p99 latency | - | <2500ms | <10000ms | <12000ms |
| Success rate | 100% | >99% | >99% | >99% |
| First event | - | - | <1500ms | <2000ms |

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
- Use test markers to run specific tests
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
4. **Clean up after tests** - Don't leave test data around
5. **Run tests frequently** - Don't wait until the end to test

## Related Documentation

- [Architecture](../concepts/architecture.md) - How components are structured
- [Configuration](../getting-started/configuration.md) - Test environment settings
- [Observability](../operations/observability.md) - Monitor test performance
