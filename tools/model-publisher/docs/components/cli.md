# CLI Reference

This document explains all command-line options for the Model Publisher.

## Usage

```bash
python main.py --model <name> --version <tag> [options]
```

## Arguments

| Argument | Required | Default | Description |
|----------|----------|---------|-------------|
| `--model` | Yes | — | Model name (e.g., `detect-ai-spark`) |
| `--version` | Yes | — | Version tag (e.g., `v1.0.0`) |
| `--description` | No | `Production release <version>` | Release description text |
| `--assets-dir` | No | `assets` (from config) | Override assets base directory |
| `--dry-run` | No | `false` | Validate only, do not upload or tag |
| `--verbose` | No | `false` | Enable verbose logging |

## Examples

### Basic Publish

```bash
python main.py --model detect-ai-spark --version v1.0.0
```

Publishes the `detect-ai-spark` model at version `v1.0.0` with the default description.

### Publish with Custom Description

```bash
python main.py --model detect-ai-spark --version v1.0.1 --description "Bug fix for tokenization edge case"
```

### Dry-Run (Validate Only)

```bash
python main.py --model detect-ai-spark --version v1.0.0 --dry-run
```

Validates inputs and checks the asset directory exists, but never touches HuggingFace. Recommended before every real publish.

### Custom Assets Directory

```bash
python main.py --model detect-ai-spark --version v1.0.0 --assets-dir /tmp/trained-models
```

Looks for assets at `/tmp/trained-models/detect-ai-spark` instead of the default `./assets/detect-ai-spark`.

### Verbose Output

```bash
python main.py --model detect-ai-spark --version v1.0.0 --verbose
```

Enables detailed logging for debugging.

### All Options Combined

```bash
python main.py \
  --model detect-ai-spark \
  --version v1.0.0 \
  --description "Hotfix release" \
  --assets-dir ./custom-assets \
  --verbose
```

## Makefile Shortcuts

The Makefile provides convenient shortcuts for common operations.

| Command | Equivalent To | Description |
|---------|---------------|-------------|
| `make dry-run model=detect-ai-spark v=v1.0.0` | `python main.py --model detect-ai-spark --version v1.0.0 --dry-run` | Validate without uploading |
| `make upload-spark v=v1.0.0` | `python main.py --model detect-ai-spark --version v1.0.0` | Publish detect-ai-spark |
| `make upload-flare v=v1.0.0` | `python main.py --model detect-ai-flare --version v1.0.0` | Publish detect-ai-flare |
| `make upload model=detect-ai-spark v=v1.0.0` | `python main.py --model detect-ai-spark --version v1.0.0` | Publish any model |
| `make install` | `poetry install --no-interaction` | Install dependencies |
| `make lint` | `ruff check .` | Run linter |
| `make format` | `ruff format --check .` | Check formatting |
| `make test` | `pytest -m "not integration"` | Run unit tests |
| `make test-all` | `pytest` | Run all tests |
| `make test-cov` | `pytest --cov=src --cov-fail-under=70` | Tests with coverage gate |
| `make clean` | `rm -rf .pytest_cache .ruff_cache .coverage htmlcov` | Clean generated files |

### Makefile Examples

```bash
# Validate before publishing
make dry-run model=detect-ai-spark v=v1.0.0

# Publish detect-ai-spark
make upload-spark v=v1.0.0

# Publish detect-ai-flare
make upload-flare v=v1.0.0

# Publish with custom description (pass extra args after --)
make upload model=detect-ai-spark v=v1.0.1 -- --description "hotfix" --assets-dir ./assets
```

## Output

### Success Output

```
Publishing detect-ai-spark @ v1.0.0 ...
  description: Production release v1.0.0
  hf_user: myuser  token: hf_****xxxx
Uploaded to https://huggingface.co/myuser/detect-ai-spark/tree/v1.0.0
Tagged v1.0.0
Publication completed successfully.
```

### Dry-Run Output

```
dry-runPublishing detect-ai-spark @ v1.0.0 ...
  description: Production release v1.0.0
  hf_user: myuser  token: hf_****xxxx
  mode: DRY-RUN (no upload/tag)
Dry-run validated: /path/to/assets/detect-ai-spark -> myuser/detect-ai-spark (v1.0.0)
Dry-run completed successfully.
```

### Error Output

```
Artifacts not found: Assets not found at /path/to/assets/detect-ai-spark
  path: /path/to/assets/detect-ai-spark
```

```
Operation failed: Failed to upload to HF repo myuser/detect-ai-spark: Rate limit exceeded
```

```
Invalid input: version must match '^v\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$' (e.g. v1.0.0), got '1.0.0'
```

## Exit Codes

| Code | Meaning | When |
|------|---------|------|
| `0` | Success | Publish or dry-run completed |
| `1` | Runtime error | Upload failed, tag failed, artifact not found, unexpected error |
| `2` | Usage/config error | Invalid arguments, bad model key/version, missing config |

## Tips

1. **Always dry-run first** — Use `--dry-run` before any real publish to catch issues early
2. **Use semantic versioning** — Follow `vMAJOR.MINOR.PATCH` (e.g., `v1.0.0`, `v1.2.3`)
3. **Check the banner** — The tool prints what it's about to do before doing it
4. **Token is redacted** — Your `HF_TOKEN` is never printed in full, only `hf_****xxxx`

## Related Documentation

- [Configuration](../getting-started/configuration.md) - Environment variables and settings
- [Validation](validation.md) - Input validation rules
- [Publishing Flow](../concepts/publishing-flow.md) - What happens during a publish
