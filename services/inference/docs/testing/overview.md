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

**What they are:** Tests that check multiple parts working together — the real gRPC server, interceptors, batching proxy and the full analysis pipeline — wired over a loopback port.

**When to use:** Before committing code.

**Speed:** Medium (seconds to a minute).

**Dependencies:** None. They use a built-in `DummyEngine` (returns `0.5` for every chunk), so no model files are downloaded and no Docker is needed.

```bash
# Run integration tests
make test-integration
```

**Example:** Testing that a full `AnalyzeDocument` stream emits `started` → `progress` → `final`, or that an invalid API key gets rejected.

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
│   ├── conftest.py                       # Shared fixtures
│   ├── unit/
│   │   ├── domain/
│   │   │   └── test_exceptions.py        # Domain exceptions
│   │   ├── application/
│   │   │   ├── test_document_analysis.py # Analysis use case
│   │   │   ├── test_validation.py        # Input validation
│   │   │   ├── test_aggregation.py       # Weighted scoring + highlights
│   │   │   └── test_dispatcher.py        # Chunk worker pool
│   │   ├── adapters/
│   │   │   ├── inbound/grpc/
│   │   │   │   ├── test_interceptors.py  # Auth + monitoring
│   │   │   │   ├── test_servicer.py      # RPC handlers
│   │   │   │   ├── test_server.py        # Server + health monitor
│   │   │   │   └── test_server_smoke.py  # Startup smoke test
│   │   │   └── outbound/inference/
│   │   │       ├── test_batcher.py       # Batching proxy
│   │   │       ├── test_engines.py       # Spark/Flare engines
│   │   │       ├── test_base_engine.py   # Logit decoding
│   │   │       ├── test_loader.py        # HF download + sessions
│   │   │       └── test_session_options.py # ONNX session tuning
│   │   └── infrastructure/
│   │       ├── test_config.py            # Settings validation
│   │       ├── test_container.py         # Composition root
│   │       ├── test_log_setup.py         # structlog setup
│   │       └── test_tracing.py           # OTel setup
│   └── integration/
│       ├── conftest.py                   # DummyEngine + test server
│       ├── test_pipeline.py              # End-to-end RPC tests
│       ├── test_observability.py         # Metrics + health tests
│       └── test_concurrency.py           # Batching + cancellation
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
    validator = InputValidator(max_text_chars=50000)
    assert validator.validate("Hello, world!") == "Hello, world!"

def test_validate_empty_text():
    with pytest.raises(InvalidInputError):
        InputValidator(max_text_chars=50000).validate("")

def test_validate_too_long():
    with pytest.raises(InvalidInputError):
        InputValidator(max_text_chars=100).validate("a" * 101)
```

### Integration Test Example

Integration tests spin up a real gRPC server on a free port using the `integration_app` fixture (which wires in a `DummyEngine`) and call it through a real client stub:

```python
import pytest
import grpc
from src.generated import ai_service_pb2, ai_service_pb2_grpc

async def test_detect_rejects_missing_token(integration_app):
    channel = grpc.aio.insecure_channel(f"localhost:{integration_app['port']}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    request = ai_service_pb2.PredictRequest(text="hello", model_id="spark")

    with pytest.raises(grpc.aio.AioRpcError) as exc:
        await stub.Detect(request)
    assert exc.value.code() == grpc.StatusCode.UNAUTHENTICATED

    await channel.close()
```

No model download, no Docker, no test markers — `asyncio_mode = "auto"` in `pyproject.toml` handles async tests automatically.

## Test Coverage

Coverage shows what percentage of your code is tested.

```bash
# Generate coverage report (also writes htmlcov/ and coverage.xml)
make test-coverage

# View the HTML report (from services/inference)
python -m http.server 8000 --directory htmlcov
# then open http://localhost:8000
```

### Coverage Goals

| Code Type | Target Coverage |
|-----------|-----------------|
| Business logic | > 80% |
| API handlers | > 70% |
| Adapters | > 60% |
| Utilities | > 50% |

CI enforces a floor of **60% overall** (`pytest --cov-fail-under=60`) on the `main`/`staging` workflow; the targets above are what to aim for locally.

## Continuous Integration

`.github/workflows/service-inference.yaml` runs on pushes and pull requests targeting `main` or `staging` whenever anything under `services/inference/**` changes. It:

1. Installs dependencies with `poetry install --extras cpu`
2. Regenerates the protobuf stubs (same commands as `make proto`)
3. Lints with `ruff check . --select F,E --ignore E501`
4. Runs the unit tests with `--cov-fail-under=60`
5. Runs the integration tests
6. Builds and pushes the Docker image to Docker Hub (second job, `Build & Push Docker Image`)

Both test steps export `API_KEY=ci-dummy-key-16chars-long`, because `Settings` requires a 16+ character key. If you run pytest outside CI, export an `API_KEY` of your own first.

> `dev` runs no CI — verify locally before opening a pull request.

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

**Problem:** `make inference-up` or `make load-test` fails because Docker isn't running.

**Solution:** Start Docker Desktop or run `dockerd`. Unit and integration tests do **not** need Docker — only the compose-based and load-test targets do.

### "Port already in use"

**Problem:** Tests fail because another process is using the port.

**Solution:** Stop the other process or use a different port.

### "Tests are slow"

**Problem:** Tests take too long to run.

**Solution:**
- Run only unit tests for quick feedback (`make test`)
- Run a single file: `poetry run pytest tests/unit/application/test_validation.py -v`
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
