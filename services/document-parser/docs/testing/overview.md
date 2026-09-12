# Testing

This document explains how to test the Document Parser service. Testing ensures the service works correctly and catches bugs before they reach users.

## Why Test?

Testing helps you:

- **Catch bugs early** - Find problems before users do
- **Ensure quality** - Verify features work as expected
- **Enable changes** - Safely modify code knowing tests will catch mistakes
- **Document behavior** - Tests show how the service should work

## Testing Levels

The Document Parser service has three levels of testing, each with different tradeoffs:

### Unit Tests

**What they are:** Tests that check individual parts of the code in isolation.

**When to use:** Every time you change code.

**Speed:** Fast (seconds).

**Dependencies:** None (uses mocks and fakes).

```bash
# Run unit tests
make test

# Run with coverage report
make test-coverage
```

**Example:** Testing that the PDF extractor handles page limits correctly.

### Integration Tests

**What they are:** Tests that check multiple parts working together with real files.

**When to use:** Before committing code.

**Speed:** Medium (minutes).

**Dependencies:** Docker (for running the service).

```bash
# Run integration tests
make test-integration
```

**Example:** Testing that uploading a PDF and extracting text works end-to-end.

### Load Tests

**What they are:** Tests that check how the service performs under heavy traffic.

**When to use:** Before deploying to production or after performance changes.

**Speed:** Slower (minutes).

**Dependencies:** Docker (for running the service + k6).

```bash
# Run load tests
make load-test
```

**Example:** Testing that the service handles 100 concurrent extractions.

## Choosing Which Tests to Run

| Change Type | Run These Tests |
|-------------|-----------------|
| Small bug fix | Unit tests |
| New feature | Unit + Integration |
| Configuration change | Unit + Integration |
| Extraction logic change | Unit + Integration + Load |
| Production deployment | All tests |
| Quick check | Unit tests |

## Test Structure

```
document-parser/
├── tests/
│   ├── conftest.py                    # Shared fixtures (client, sample files, pool mock)
│   ├── unit/
│   │   ├── api/
│   │   │   ├── test_deps.py           # validate_upload: size guard, MIME sniff
│   │   │   ├── test_exception_handlers.py  # Error handler: safe detail, metrics
│   │   │   └── v1/endpoints/
│   │   │       ├── test_extract.py    # POST /extract: success, errors, timeouts
│   │   │       ├── test_extract_edge.py  # Edge cases: missing file, empty filename
│   │   │       ├── test_health.py     # /health, /ready: pool states
│   │   │       └── test_health_extra.py  # /metrics, race guard
│   │   ├── core/
│   │   │   ├── test_config.py         # Settings validation, env normalization
│   │   │   ├── test_exceptions.py     # Exception hierarchy, status codes
│   │   │   ├── test_logging.py        # JSON formatter, middleware logging
│   │   │   └── test_metrics.py        # All Prometheus metrics, classification
│   │   └── domain/
│   │       ├── test_cleaner.py        # TextCleaner: all 10 cleaning steps
│   │       ├── test_entities.py       # ExtractionResult dataclass
│   │       └── test_extractions.py    # ExtractionService, strategies, factory
│   └── integration/
│       └── test_extract_integration.py  # End-to-end extraction with real files
├── load/
│   ├── script.js                      # k6 load test script
│   ├── fixtures/                      # Sample files (PDF, DOCX, TXT)
│   └── README.md                      # Load test documentation
└── docs/
    └── testing/
        └── overview.md                # This file
```

## Writing Tests

### Unit Test Example

```python
def test_pdf_extractor_rejects_too_many_pages():
    """Test that PDF extractor rejects documents with > 1000 pages."""
    # Arrange
    extractor = PdfExtractor()

    # Act & Assert
    with pytest.raises(DocumentTooLargeError):
        extractor.extract("path/to/huge.pdf")
```

### Integration Test Example

```python
@pytest.mark.integration
def test_extract_pdf_returns_text(client):
    """Test that uploading a PDF returns extracted text."""
    # Arrange
    with open("tests/fixtures/sample.pdf", "rb") as f:
        # Act
        response = client.post(
            "/api/v1/extract",
            files={"file": ("sample.pdf", f, "application/pdf")}
        )

    # Assert
    assert response.status_code == 200
    data = response.json()
    assert "text" in data
    assert len(data["text"]) > 0
    assert data["truncated"] is False
```

### Validation Test Example

```python
def test_reject_oversized_file(mocker):
    """Test that files over 10 MiB are rejected at upload."""
    mock_magic = mocker.patch("app.api.deps.magic.from_buffer")
    upload = _upload(b"x" * 10, "big.pdf", size=11 * 1024 * 1024)

    with pytest.raises(FileTooLargeError):
        asyncio.run(validate_upload(upload))

    # Magic should not even be called -- size check is first
    mock_magic.assert_not_called()
```

## Test Coverage

Coverage shows what percentage of your code is tested.

```bash
# Generate coverage report
make test-coverage

# View coverage in browser
python -m coverage html
open htmlcov/index.html
```

### Coverage Goals

| Code Type | Target Coverage |
|-----------|-----------------|
| Business logic | > 80% |
| API handlers | > 70% |
| Parsers | > 60% |
| Utilities | > 50% |

## Load Testing

Load testing checks how the service performs under heavy traffic.

```bash
# Run with default settings (5 VUs, 10s)
make load-test

# Run with custom VUs and duration
make load-test VUS=20 DURATION=1m RAMP_TIME=30s

# Run in RPS mode (target requests per second)
make load-test MODE=rps RPS=100 VUS=50 DURATION=2m

# Stop load test stack
make load-down
```

### Load Test Modes

| Mode | What It Does | When to Use |
|------|--------------|-------------|
| `vus` (default) | Simulates N virtual users with ramp-up/down | Realistic traffic simulation |
| `rps` | Targets N requests per second with open-model arrival | Throughput testing |
| `health` | Simple health check loop (5 VUs, 30s) | Smoke testing |

### Load Test Scenarios

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| Smoke | 5 | 30 seconds | Quick sanity check |
| Load | 20 | 2 minutes | Realistic traffic |
| Stress | 50-100 | 5 minutes | Find breaking point |

Each virtual user picks a random file (PDF, DOCX, or TXT) from `load/fixtures/`, uploads it as `multipart/form-data`, and verifies a `200` response with valid `text` field.

### Thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `http_req_duration p(95)` | < 1500ms | 95% of requests under 1.5 seconds |
| `http_req_duration p(99)` | < 3000ms | 99% of requests under 3 seconds |
| `errors rate` | == 0 | Zero errors allowed |

## Common Testing Issues

### "Docker not running"

**Problem:** Integration tests fail because Docker isn't running.

**Solution:** Start Docker Desktop or run `dockerd`.

### "Port already in use"

**Problem:** Tests fail because another process is using port 8000.

**Solution:** Stop the other process or use a different port:
```bash
lsof -i :8000
kill <PID>
```

### "Tests are slow"

**Problem:** Tests take too long to run.

**Solution:**
- Run only unit tests for quick feedback (`make test`)
- Use `pytest -k "test_name"` to run specific tests
- Check if tests are doing unnecessary work

### "Flaky tests"

**Problem:** Tests sometimes pass, sometimes fail.

**Solution:**
- Check for race conditions in pool metrics
- Ensure tests clean up after themselves (conftest clears all metrics)
- Use proper test isolation (settings cache cleared per test)

## Best Practices

1. **Write tests before fixing bugs** - Ensure the bug exists, then write a test that catches it
2. **Keep tests simple** - Each test should test one thing
3. **Use descriptive names** - Test names should explain what they test
4. **Clean up after tests** - Don't leave temp files or test data
5. **Run tests frequently** - Don't wait until the end to test

## Related Documentation

- [Architecture](../concepts/architecture.md) - How components are structured
- [Configuration](../getting-started/configuration.md) - Test environment settings
- [Observability](../operations/observability.md) - Monitor test performance
