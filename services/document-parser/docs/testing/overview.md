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
│   ├── script.js                      # Legacy entrypoint (MODE=vus|rps), now shares lib helpers
│   ├── lib/                           # Shared k6 helpers (config, files, metrics, requests)
│   ├── scenarios/                     # smoke, load, stress, soak, negative
│   ├── fixtures/                      # Sample files (PDF, DOCX, TXT in several sizes)
│   └── README.md                      # Full load test reference
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

Load testing checks how the service performs under heavy traffic. Pick a scenario that matches your question -- each one is a small k6 script under `load/scenarios/` sharing the same helpers in `load/lib/`.

```bash
# Quick smoke: health plus one extract per file type, fails fast
make load-test SCENARIO=smoke

# Realistic ramped load (default: 5 VUs, short hold)
make load-test SCENARIO=load VUS=20 DURATION=1m RAMP_TIME=30s

# Arrival-rate stress to find saturation (watch readiness 503s, not extract errors)
make load-test SCENARIO=stress RPS=20 STAGES="10s:5,30s:20,10s:0" MAX_VUS=100

# Long steady soak to catch leaks and latency drift
make load-test SCENARIO=soak VUS=2 DURATION=10m

# Rejection checks: unsupported type, empty file, corrupt PDF, missing file
make load-test SCENARIO=negative

# Old interface still works (now shares the same lib, thresholds scoped per scenario)
make load-test SCENARIO=legacy MODE=rps VUS=50 RPS=100 DURATION=2m

# Stop everything
make load-down
```

Shortcuts exist too: `make load-test-smoke`, `load-test-load`, `load-test-stress`, `load-test-soak`, `load-test-negative`.

### Running Against an Existing Deployment

The rig above starts its own throwaway parser. To measure a deployment that is already running -- a local stack, the Floci stack, prod -- point the same scripts at it instead. Nothing is provisioned: the k6 container runs with `--no-deps`, so the parser under test is never started by the load run.

```bash
make load-test REMOTE=1 TARGET_ENV_FILE=../../e2e/targets/.env.prod SCENARIO=load
```

The target file carries the endpoint and any credentials. A deployed stack already exports its own telemetry, so `WITH_OBSERVABILITY` does not apply to remote runs.

The `e2e/` harness drives this and the other services together, one tier at a time:

```bash
make -C e2e load TIER=preflight TARGET=prod   # is everything reachable
make -C e2e load TIER=smoke TARGET=prod        # is everything correct
make -C e2e load TIER=load TARGET=prod         # does everything hold
```

See [e2e/README.md](../../../../e2e/README.md) for the tiers and the target files.

### What Each Scenario Does

Think of scenarios as answering different questions:

| Scenario | Question It Answers | Default Shape | Pass Bar |
|----------|---------------------|---------------|----------|
| `smoke` | "Did I break the basics?" | 1 VU, 1 iteration per file type + health | All checks pass |
| `load` | "How does normal traffic feel?" | Ramping VUs (`5s:5,10s:5,5s:0`), 1-3s think time | `p95 < 1500ms`, `p99 < 3000ms`, txt `p95 < 500ms`, success `>= 99%` |
| `stress` | "Where does it saturate gracefully?" | Arrival-rate (`10s:5,30s:10,10s:0`), 20 preallocated / 100 max VUs | `p95 < 3000ms`, `p99 < 6000ms`, success `>= 95%`, readiness `503`s counted separately |
| `soak` | "Does it leak or drift over time?" | 2 VUs for 5m | `p95 < 3000ms`, `p99 < 5000ms`, success `>= 99%` |
| `negative` | "Do guards still reject bad input?" | 1 VU, 8 iterations over 4 rejection cases | Rejection checks `== 100%` |
| `legacy` | "Old MODE interface" | `MODE=vus\|rps` with shared lib | Scoped latency, success `>= 99%` |

Every extract iteration round-robins deterministically over `DOCPARSER_LOAD_PROFILES` (default `txt-small,txt-medium,txt-large,pdf-small,docx-small`), so each run covers the full mix the same way. Text fixtures come in committed sizes (`sample.txt` 26B, `sample-medium.txt` 4K, `sample-large.txt` 100K, `sample-near-limit.txt` 500K opt-in via `txt-near-limit`); binaries are `sample.pdf` 787B and `sample.docx` 36K. Each request carries a `35s` timeout (covers the `30s` extraction timeout plus margin) and tags (`service`, `test_type`, `mime`, `profile`, `size`) so loadtest dashboards stay correlatable. `504`s and 30s+ timings count as timeouts; `/ready` `503`s count as backpressure, not failures.

### Observability for Load Runs

By default load runs are offline -- no collector, nothing leaves your machine. To push traces, metrics, and logs to New Relic as `deployment.environment=loadtest`:

```bash
export NEW_RELIC_LICENSE_KEY="..."   # ingest key, never commit it
make load-test SCENARIO=load WITH_OBSERVABILITY=1 VUS=20 DURATION=2m
```

This adds `otel-collector-loadtest` (scrapes `/api/v1/metrics`, collects host and per-container CPU/memory/network). `ENV_TYPE` stays `dev`, so only the telemetry label changes. Empty key means the collector retries and drops while apps keep running. See [Observability](../operations/observability.md) for the full pipeline and [load/README.md](../../load/README.md) for every `DOCPARSER_LOAD_*` knob.

### When to Run Which

- **Smoke** before any deploy -- fast sanity.
- **Load** (`VUS=10-20`, `2m`) to verify latency and success on a realistic mix.
- **Stress** to watch pool saturation -- expect graceful `/ready` `503`s rather than extract errors.
- **Soak** (`5-30m`) with observability on to catch leaks.
- **Negative** after touching validation or limits.

One caveat: the load stack runs `WORKERS=1` by default so k6 and the service fit on one machine (override with `WORKERS=4`). Don't read those throughput numbers as production capacity without accounting for that.

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
