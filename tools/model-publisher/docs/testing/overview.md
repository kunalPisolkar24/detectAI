# Testing

This document explains how to test the Model Publisher. Testing ensures the tool works correctly and catches issues before publishing real models.

## Why Test?

Testing helps you:
- **Catch bugs early** — Find problems before they affect published models
- **Ensure quality** — Verify validation, upload, and tagging work correctly
- **Enable changes** — Safely modify code knowing tests will catch mistakes
- **Document behavior** — Tests show how the tool should behave

## Testing Levels

The Model Publisher has two levels of testing, each with different tradeoffs:

### Unit Tests

**What they are:** Tests that check individual parts of the code in isolation, using fake implementations.

**When to use:** Every time you change code.

**Speed:** Fast (seconds).

**Dependencies:** None (no network, no real filesystem).

```bash
# Run unit tests
make test

# Run with coverage report
make test-cov
```

**Example:** Testing that the use case calls the registry's upload and tag methods in the correct order.

### Integration Tests

**What they are:** Tests that check multiple parts working together. The HuggingFace API is mocked, but filesystem operations use real temporary directories.

**When to use:** Before committing code.

**Speed:** Medium (seconds, but slower than unit tests).

**Dependencies:** None (mocked HF, `tmp_path` for filesystem).

```bash
# Run all tests (unit + integration)
make test-all
```

**Example:** Testing that the composition root correctly wires all components and a dry-run completes without calling the API.

## Choosing Which Tests to Run

| Change Type | Run These Tests |
|-------------|-----------------|
| Small bug fix | Unit tests |
| New feature | Unit + Integration |
| Validation changes | Unit + Integration |
| CLI argument changes | Unit tests |
| Configuration changes | Unit + Integration |
| Quick check | Unit tests |
| Before commit | All tests |

## Test Structure

```
tools/model-publisher/tests/
├── conftest.py                         # Shared fixtures
├── unit/
│   ├── test_publish_use_case.py        # PublishModelUseCase tests
│   ├── test_schemas.py                 # ModelMetadata / ArtifactBundle tests
│   ├── test_cli_parser.py              # CLI argument parsing tests
│   └── test_config_provider.py         # Settings provider tests
└── integration/
    ├── test_composition_integration.py # Full wiring tests (mocked HF)
    ├── test_resolver_integration.py    # Filesystem resolver with tmp_path
    └── test_hf_adapter_integration.py  # HuggingFace adapter with mocked API
```

## Test Doubles (Fakes)

The tests use **fake implementations** instead of real ones. This is possible because the tool uses interfaces (ports).

### FakeRegistry

Implements `IModelRegistry` without touching HuggingFace:

```python
class FakeRegistry(IModelRegistry):
    def __init__(self, *, fail_upload=False, fail_tag_exists=False):
        self.calls = []           # Track which methods were called
        self.fail_upload = fail_upload
        self.fail_tag_exists = fail_tag_exists

    def upload_artifacts(self, bundle):
        self.calls.append("upload")
        if self.fail_upload:
            raise UploadFailedException("boom", repo_id="x")
        return "https://huggingface.co/test/model/tree/v1.0.0"

    def set_version_tag(self, bundle):
        self.calls.append("tag")
        if self.fail_tag_exists:
            raise TagFailedException("already exists", repo_id="x", tag="v1.0.0")
```

### FakeStore

Implements `IArtifactStore` with optional failure:

```python
class FakeStore(IArtifactStore):
    def __init__(self, base, *, missing=False):
        self.base = base
        self.missing = missing

    def resolve(self, model_key, version, description=None):
        if self.missing:
            raise ArtifactNotFoundException("not found")
        return ArtifactBundle(
            metadata=ModelMetadata(model_key=model_key, version=version, description="test"),
            local_path=self.base / "assets" / model_key,
        )
```

### Using Mocked HfApi

Integration tests use `unittest.mock.MagicMock` to simulate the HuggingFace API:

```python
api = MagicMock()
api.upload_folder.return_value = "https://huggingface.co/user/model/tree/v1.0.0"

uc = build_publisher(settings, api=api)
result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0"))

api.upload_folder.assert_called_once()
api.create_tag.assert_called_once()
```

## Test Coverage

Coverage shows what percentage of your code is tested.

```bash
# Generate coverage report
make test-cov

# View coverage in browser
poetry -C tools/model-publisher run coverage html
open htmlcov/index.html
```

### Coverage Goals

| Code Type | Target Coverage |
|-----------|-----------------|
| Domain schemas | > 90% |
| Use cases | > 85% |
| CLI parser | > 80% |
| Infrastructure adapters | > 70% |
| **Overall** | **> 70%** (enforced by CI) |

The CI pipeline enforces a **70% minimum** coverage gate. Tests fail if coverage drops below this.

## Running Tests

### Quick Reference

| Command | What It Runs | Speed |
|---------|--------------|-------|
| `make test` | Unit tests only | Fast |
| `make test-all` | Unit + Integration | Medium |
| `make test-cov` | Unit tests with coverage report | Fast |
| `make lint` | Ruff linter | Fast |

### Unit Tests

```bash
# From project root
make -C tools/model-publisher test

# Or with Poetry directly
poetry -C tools/model-publisher run pytest -q -m "not integration"
```

### All Tests

```bash
# From project root
make -C tools/model-publisher test-all

# Or with Poetry directly
poetry -C tools/model-publisher run pytest -q
```

### With Coverage

```bash
# From project root
make -C tools/model-publisher test-cov

# Or with Poetry directly
poetry -C tools/model-publisher run pytest -m "not integration" --cov=src --cov-report=term-missing --cov-fail-under=70
```

### Linting

```bash
# Check for lint errors
make -C tools/model-publisher lint

# Check formatting
make -C tools/model-publisher format
```

## Writing Tests

### Unit Test Pattern

```python
def test_use_case_happy_path(tmp_path):
    # Arrange: Set up fake implementations
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    registry = FakeRegistry()
    store = FakeStore(tmp_path)
    uc = PublishModelUseCase(registry, store)

    # Act: Execute the use case
    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0"))

    # Assert: Check the result
    assert result.model == "detect-ai-spark"
    assert result.version == "v1.0.0"
    assert result.url is not None
    assert registry.calls == ["upload", "tag"]
```

### Integration Test Pattern

```python
@pytest.mark.integration
def test_composition_build_and_dry_run(tmp_path, tmp_assets):
    # Arrange: Use real settings with mocked API
    settings = Settings(
        hf_token="hf_test123",
        hf_username="alice",
        project_root_dir=str(tmp_assets),
        assets_dir_name="assets",
    )
    api = MagicMock()

    # Act: Build and execute through the container
    uc = build_publisher(settings, api=api)
    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0", dry_run=True))

    # Assert: Dry-run completed, no API calls made
    assert result.dry_run is True
    api.upload_folder.assert_not_called()
    api.create_tag.assert_not_called()
```

### Testing Error Paths

```python
def test_upload_failure_does_not_tag(tmp_path):
    # Arrange: Registry that fails on upload
    (tmp_path / "assets" / "detect-ai-spark").mkdir(parents=True)
    registry = FakeRegistry(fail_upload=True)
    store = FakeStore(tmp_path)
    uc = PublishModelUseCase(registry, store)

    # Act & Assert: Upload fails, tag is never called
    with pytest.raises(UploadFailedException):
        uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0"))

    assert registry.calls == ["upload"]  # tag was never attempted
```

## Common Testing Issues

### "No module named src"

**Problem:** Tests fail with import errors.

**Solution:** Make sure you're running from the `tools/model-publisher` directory, or use `poetry run`:

```bash
poetry -C tools/model-publisher run pytest
```

### "Coverage below 70%"

**Problem:** The coverage gate fails.

**Solution:** Check which files have low coverage and add tests. The `--cov-report=term-missing` flag shows uncovered lines.

### "Tests pass locally but fail in CI"

**Problem:** CI uses different Python version or dependencies.

**Solution:** Check the CI workflow (`.github/workflows/tools-model-publisher.yaml`) for the Python version and ensure your tests don't depend on local state.

## CI Pipeline

The GitHub Actions workflow runs on every push to `tools/model-publisher/**`:

1. **Lint** — `ruff check .`
2. **Unit tests** — `pytest -m "not integration"` with 70% coverage gate
3. **Integration tests** — `pytest -m integration`

Feature branches targeting `dev` don't run CI automatically. Paste local `make lint/test` output in your PR.

## Best Practices

1. **Write tests before fixing bugs** — Ensure the bug exists, then write a test that catches it
2. **Keep tests simple** — Each test should test one thing
3. **Use descriptive names** — Test names should explain what they test (e.g., `test_upload_failure_does_not_tag`)
4. **Use fakes over mocks** — Fake implementations are clearer than mock chains
5. **Clean up after tests** — Use `tmp_path` fixture (auto-cleaned) instead of real directories
6. **Run tests frequently** — Don't wait until the end to test

## Related Documentation

- [Architecture](../concepts/architecture.md) — How the testable design works
- [Configuration](../getting-started/configuration.md) — Settings for test environments
- [Publishing Flow](../concepts/publishing-flow.md) — What the tests verify
