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
│   ├── test_extractor.py      # Tests for PDF, DOCX, TXT extraction
│   ├── test_validator.py      # Tests for MIME sniff, size check
│   ├── test_cleaner.py        # Tests for TextCleaner
│   └── test_app.py            # Tests for FastAPI endpoints
├── load/
│   ├── script.js              # k6 load test script
│   ├── fixtures/              # Sample files for testing
│   │   ├── sample.pdf
│   │   ├── sample.docx
│   │   └── sample.txt
│   └── README.md              # Load test documentation
└── docs/
    └── testing/
        └── overview.md        # This file
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
async def test_extract_pdf_returns_text():
    """Test that uploading a PDF returns extracted text."""
    # Arrange
    async with httpx.AsyncClient(app=app) as client:
        with open("tests/fixtures/sample.pdf", "rb") as f:
            # Act
            response = await client.post(
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
def test_reject_oversized_file():
    """Test that files over 10 MiB are rejected."""
    # Arrange
    large_content = b"x" * (10 * 1024 * 1024 + 1)

    # Act
    with pytest.raises(FileTooLargeError):
        validate_upload(large_content)
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
# Run with default settings
make load-test

# Run with custom settings
make load-test VUS=20 DURATION=1m

# Run in RPS mode
make load-test MODE=rps RPS=100 VUS=50
```

### Load Test Modes

| Mode | What It Does | When to Use |
|------|--------------|-------------|
| `vus` (default) | Simulates N virtual users | Realistic traffic simulation |
| `rps` | Targets N requests per second | Throughput testing |
| `health` | Simple health check loop | Smoke testing |

### Load Test Scenarios

| Scenario | Virtual Users | Duration | Purpose |
|----------|---------------|----------|---------|
| Smoke | 5 | 30 seconds | Quick sanity check |
| Load | 20 | 2 minutes | Realistic traffic |
| Stress | 50 | 5 minutes | Find breaking point |

Each virtual user picks a random file (PDF, DOCX, or TXT) from `load/fixtures/`, uploads it, and verifies a `200` response.

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
- Check for race conditions
- Ensure tests clean up after themselves
- Use proper test isolation

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
