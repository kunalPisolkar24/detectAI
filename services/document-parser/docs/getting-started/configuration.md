# Configuration

This document explains how to configure the Document Parser service for `ENV_TYPE=dev` (local compose) and `ENV_TYPE=prod` (AWS).

## Env Type

| Var | Default | Required | Notes |
|-----|---------|----------|-------|
| `ENV_TYPE` | `dev` | no | Canonical switch. `dev` = local docker-compose with `.env` / `ENV_FILE`; `prod` = AWS Secrets Manager + SSM. `development` -> `dev`, `production` -> `prod` aliases accepted, otherwise must be `dev` or `prod`. |

## How Configuration Works

* `ENV_TYPE=dev` -- loads `.env` in CWD if present, else `$ENV_FILE` (best-effort via `python-dotenv`), applies dev defaults, validates.
* `ENV_TYPE=prod` -- loads Secrets Manager + SSM via boto3, applies non-secret env overrides, then validates with strict prod checks.

Precedence: `process env` > AWS (Secrets + SSM) > prod-non-secret-overrides > schema defaults. Empty strings never override (compose passthrough `${VAR:-}`).

## Required Configuration

None for `ENV_TYPE=dev` -- all settings have sensible defaults for local development.

```bash
ENV_TYPE=dev                  # local development (default)
```

## Optional Configuration

### Network

```bash
PORT=8000                     # default 8000, gunicorn/uvicorn bind
WORKERS=4                     # gunicorn worker processes (shell-only, not via SSM)
```

### Extraction Settings

```bash
WORKER_THREADS=4              # ThreadPoolExecutor size (default: cpu_count || 4, range 1..128)
MAX_UPLOAD_SIZE_BYTES=10485760        # 10 MiB, 413 if exceeded
MAX_TEXT_LENGTH=1000000               # 1M chars, truncate output
MAX_PDF_PAGES=1000                    # 422 if exceeded
MAX_DOCX_UNCOMPRESSED_BYTES=104857600 # 100 MB, zip bomb guard
EXTRACTION_TIMEOUT_SECONDS=30.0       # 504 on timeout, max 600
READINESS_MAX_QUEUE_DEPTH=50          # queued >= 50 -> 503
```

### PDF Extraction Tuning

```bash
HEADER_FOOTER_MARGIN_PT=40.0         # PDF header/footer strip margin (0..500 points)
HEADER_REPETITION_RATIO=0.8          # drop repeated lines on >= ratio pages (0..1)
```

### Supported Formats

```bash
ALLOWED_MIME_TYPES=application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain
```

### Observability

```bash
LOG_LEVEL=INFO                       # DEBUG/INFO/WARNING/ERROR/CRITICAL (WARN -> WARNING normalized)
OTEL_EXPORTER_OTLP_ENDPOINT=         # http(s):// -- if empty, tracing disabled
OTEL_SERVICE_NAME=document-parser    # resource attribute
OTEL_SERVICE_VERSION=1.0.0           # alias SERVICE_VERSION
```

### AWS Bootstrap (prod only)

```bash
AWS_REGION=ap-south-1
AWS_ENDPOINT_URL=                    # Floci: http://host.docker.internal:4566
SSM_PREFIX=/detectai/document-parser/  # alias SSM_PARAM_PREFIX
SSM_ENABLED=true                     # 0|false disables SSM
DOCUMENT_PARSER_SECRETS_NAME=detectai/document-parser/secrets
```

## Environment Examples

### Local Development (ENV_TYPE=dev)

```bash
ENV_TYPE=dev
PORT=8000
LOG_LEVEL=DEBUG
```

With `.env` file, `ENV_TYPE=dev` auto-loads it (or `$ENV_FILE`). All settings default to sensible local values.

### Docker Compose (dev)

`infra/compose.yml` passes canonical vars with empty defaults (`${VAR:-}`):

```yaml
ENV_TYPE: ${ENV_TYPE:-dev}
PORT: ${PORT:-8000}
LOG_LEVEL: ${LOG_LEVEL:-}
```

Run: `docker compose -f services/document-parser/infra/compose.yml up -d --build` -- no env file needed, dev defaults apply.

### Production (AWS)

```bash
ENV_TYPE=prod
AWS_REGION=ap-south-1
# Settings pulled from Secrets Manager:
#   detectai/document-parser/secrets
# Optional non-secret overrides from env or SSM /detectai/document-parser/:
PORT=8000
LOG_LEVEL=INFO
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector:4318
```

### Floci local prod test

```bash
ENV_TYPE=prod AWS_REGION=ap-south-1 AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
  docker compose --env-file infra/.env.example -f infra/compose.yml config
```

## Configuration Validation

`Settings(BaseSettings)` validates on startup:

| Error | Cause | Fix |
|-------|-------|-----|
| `ENV_TYPE must be dev or prod` | Invalid env type | Set `ENV_TYPE=dev` or `prod` |
| `PORT must be between 1 and 65535` | Bad port | Use `8000` or similar |
| `WORKER_THREADS must be > 0` | Invalid thread count | Set to `1` or more |
| `WORKER_THREADS must be <= 128` | Too many threads | Set to `128` or fewer |
| `MAX_UPLOAD_SIZE_BYTES must be > 0` | Invalid size | Set positive integer |
| `MAX_TEXT_LENGTH must be > 0` | Invalid length | Set positive integer |
| `MAX_PDF_PAGES must be > 0` | Invalid page count | Set positive integer |
| `MAX_DOCX_UNCOMPRESSED_BYTES must be > 0` | Invalid size | Set positive integer |
| `EXTRACTION_TIMEOUT_SECONDS must be > 0` | Invalid timeout | Set positive number |
| `EXTRACTION_TIMEOUT_SECONDS must be <= 600` | Timeout too high | Set 600 or fewer |
| `READINESS_MAX_QUEUE_DEPTH must be > 0` | Invalid depth | Set positive integer |
| `HEADER_FOOTER_MARGIN_PT must be >= 0` | Invalid margin | Set 0 or more |
| `HEADER_FOOTER_MARGIN_PT must be <= 500` | Margin too high | Set 500 or fewer |
| `HEADER_REPETITION_RATIO must be >= 0` | Invalid ratio | Set 0 or more |
| `HEADER_REPETITION_RATIO must be <= 1` | Ratio too high | Set 1 or fewer |
| `ALLOWED_MIME_TYPES must not be empty` | No formats | Set at least one MIME type |
| `LOG_LEVEL must be one of ...` | Bad level | Use `DEBUG/INFO/WARNING/ERROR/CRITICAL` |
| `OTEL_EXPORTER_OTLP_ENDPOINT must be http(s) URL` | Bad OTEL URL | Use `http://` or `https://` |
| `ENV_TYPE=prod requires AWS_REGION` | Missing region in prod | Set `AWS_REGION` |

Failed validation -> service exits at startup.

## AWS

- **Secrets Manager:** `DOCUMENT_PARSER_SECRETS_NAME` or `detectai/document-parser/secrets`. JSON object keys upper-normalized and merged if missing in `cfg`; tolerant missing in prod (warning).
  ```bash
  aws secretsmanager create-secret --name detectai/document-parser/secrets --secret-string '{"SOME_KEY":"value"}'
  ```
- **SSM Parameter Store:** `SSM_PREFIX` or `/detectai/document-parser/`. `GetParametersByPath(recursive, withDecryption)` paginated, key = `Name[len(prefix):].upper().replace("-","_")`, skipped if env/cfg already set. Disable with `SSM_ENABLED=0|false`.
  ```bash
  aws ssm put-parameter --name /detectai/document-parser/max-pdf-pages --value 2000
  ```
- **Floci endpoint:** dummy `test/test` creds auto-injected when `AWS_ENDPOINT_URL` contains `localhost:4566` / `host.docker.internal:4566` without `AWS_ACCESS_KEY_ID`.

## Developer Workflow

The service includes a Makefile with common commands:

| Command | What It Does |
|---------|--------------|
| `make test` | Run all unit tests |
| `make test-coverage` | Run unit tests with coverage report |
| `make test-integration` | Run integration tests (requires Docker) |
| `make lint` | Run ruff linter |
| `make deps` | Install dependencies via Poetry |
| `make load-test` | Run k6 load tests (options: `MODE`, `VUS`, `DURATION`, `RPS`) |
| `make load-down` | Tear down the load test stack |
| `make parser-build` | Build the Docker image |
| `make parser-up` | Start the service with Docker Compose |
| `make parser-logs` | View live logs |
| `make parser-ps` | View running containers |
| `make parser-down` | Stop and clean up |
| `make parser-down-v` | Stop and remove volumes |
| `make parser-config` | Validate compose config |

**Load test examples:**
```bash
make load-test VUS=20 DURATION=1m RAMP_TIME=30s
make load-test MODE=rps RPS=100 VUS=50 DURATION=2m
make load-test MODE=vus VUS=100
```

## Troubleshooting

**Service won't start?**
- Check `ENV_TYPE` is `dev` or `prod`.
- In `prod`, verify `AWS_REGION` is set.
- Look for validation errors in logs (panic at startup).

**Connection refused?**
- Ensure the service is running (`docker compose -f infra/compose.yml ps`).
- Check `PORT` is not already in use.

**Extraction timing out?**
- Increase `EXTRACTION_TIMEOUT_SECONDS` (default 30s, max 600s).
- Check if the file is very large or complex.
- Look at pool saturation metrics.

## Related Documentation

- [Architecture](../concepts/architecture.md) -- How components connect
- [Health Checks](../components/health.md) -- How to check if configuration is working
- [Observability](../operations/observability.md) -- Monitor configuration impact
