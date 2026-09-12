# Configuration

Mirrors `services/inference` and `services/payments/gateway` / `services/workers`
(`ENV_TYPE=dev|prod` + AWS).

## Env table

| Var | Default | Range | Notes |
|---|---|---|---|
| `ENV_TYPE` | `dev` | `dev` \| `prod` | canonical switch; `CONFIG_SOURCE` / `NODE_ENV` deprecated |
| `PORT` | `8000` | `1..65535` | gunicorn / uvicorn bind |
| `WORKERS` | `4` | `>0` | gunicorn worker processes (shell-only, not via SSM) |
| `WORKER_THREADS` | `cpu_count \|\| 4` | `>0, <=128` | ThreadPoolExecutor size |
| `MAX_UPLOAD_SIZE_BYTES` | `10485760` (10 MiB) | `>0` | `413` if exceeded |
| `MAX_TEXT_LENGTH` | `1000000` (1M chars) | `>0` | truncate output |
| `MAX_PDF_PAGES` | `1000` | `>0` | `422` if exceeded |
| `MAX_DOCX_UNCOMPRESSED_BYTES` | `104857600` (100 MB) | `>0` | zip bomb guard |
| `EXTRACTION_TIMEOUT_SECONDS` | `30.0` | `>0, <=600` | `504` on timeout |
| `READINESS_MAX_QUEUE_DEPTH` | `50` | `>0` | `queued >=50` → `503` |
| `HEADER_FOOTER_MARGIN_PT` | `40.0` | `0..500` | PDF header/footer strip margin |
| `HEADER_REPETITION_RATIO` | `0.8` | `0..1` | drop repeated lines appearing on >= ratio pages |
| `ALLOWED_MIME_TYPES` | `pdf,docx,txt` list | `type/subtype` | CSV or JSON array |
| `LOG_LEVEL` | `INFO` | `DEBUG/INFO/WARNING/ERROR/CRITICAL` | normalized (`WARN` → `WARNING`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | `http(s)://` | if empty, tracing disabled |
| `OTEL_SERVICE_NAME` | `document-parser` | string | resource attribute |
| `OTEL_SERVICE_VERSION` | `1.0.0` | string | alias `SERVICE_VERSION` |
| `AWS_REGION` | `ap-south-1` | string | bootstrap for AWS clients |
| `AWS_ENDPOINT_URL` | *(empty)* | `http(s)://` | Floci / LocalStack override |
| `SSM_PREFIX` | `/detectai/document-parser/` | string | alias `SSM_PARAM_PREFIX` |
| `SSM_ENABLED` | `true` | `0\|false` opts out | disable SSM in prod |
| `DOCUMENT_PARSER_SECRETS_NAME` | `detectai/document-parser/secrets` | string | alias `DOCUMENT_PARSER_SECRETS_ARN` |

Dropped / internal-only: `API_TITLE` / `API_VERSION` (code constants), legacy
`PORT_DOC_PARSER` / `DOC_PARSER_*` / `GUNICORN_WORKERS` / lowercase
`detect_ai_network` (`DETECT_AI_NETWORK`), `PROMETHEUS_MULTIPROC_DIR`
(Dockerfile-internal), `k6` load vars (`API_URL`, `VUS`, … in `compose.load.yml` only).

## Validation

`Settings(BaseSettings, env_ignore_empty=True, extra="ignore")` validates:

- numeric ranges via `Field(gt/ge/le)` (see table)
- `PORT 1..65535`, `HEADER_REPETITION_RATIO 0..1`, `ALLOWED_MIME_TYPES` non-empty
- `ENV_TYPE` normalized (`prod`/`production` → `prod`, `dev`/`development`/`test` → `dev`)
- `LOG_LEVEL` upper-cased, `OTEL_EXPORTER_OTLP_ENDPOINT` must be `http(s)://` if set
- `OTEL_*_VERSION` accepts `SERVICE_VERSION` alias; empty strings → `None` for optional AWS/OTEL fields

Prod strict: `ENV_TYPE=prod` requires `AWS_REGION` (always present via default).

## Provider — `ENV_TYPE=dev|prod`

Single entry point `get_settings()` (`lru_cache`, clear with `clear_settings_cache()` in tests):

- `resolve_env_type()` checks `ENV_TYPE` → deprecated `CONFIG_SOURCE` (`aws|prod→prod`, `env|dev→dev`, warns) → `NODE_ENV` (`production→prod`, `test→dev`) → `dev`.
- `dev`: `_load_dotenv_for_dev()` (`.env` or `ENV_FILE`), copy `os.environ` (skip empty), `applyDevDefaults({OTEL_SERVICE_NAME, AWS_REGION})`.
- `prod`: copy env → `load_from_aws(cfg)` (Secrets Manager JSON merges keys, raw string ignored; missing secret is warning-only for this stateless service) → `loadProdNonSecretOverrides()` (allow-list of tunables above, env wins over AWS) → `_validate_prod_strict`.

Precedence: `process env` > AWS (Secrets + SSM) > prod-non-secret-overrides > schema defaults. Empty strings never override (compose passthrough `${VAR:-}`).

Caching: module-level `settings = _LazySettingsProxy()` keeps `from app.core.config import settings` working but prefer `get_settings()` DI.

## AWS

- **Secrets Manager:** `DOCUMENT_PARSER_SECRETS_NAME` / `_ARN` or `detectai/document-parser/secrets`. JSON object keys upper-normalized and merged if missing in `cfg`; tolerant missing in prod (warning). Configure via:
  ```bash
  aws secretsmanager create-secret --name detectai/document-parser/secrets --secret-string '{"SOME_KEY":"value"}'
  ```
- **SSM Parameter Store:** `SSM_PREFIX` / `SSM_PARAM_PREFIX` or `/detectai/document-parser/`. `GetParametersByPath(recursive, withDecryption)` paginated, key = `Name[len(prefix):].upper().replace("-","_")`, skipped if env/cfg already set. Disable with `SSM_ENABLED=0|false`. Example:
  ```bash
  aws ssm put-parameter --name /detectai/document-parser/max-pdf-pages --value 2000
  ```
- **Floci endpoint:** dummy `test/test` creds auto-injected when `AWS_ENDPOINT_URL` contains `localhost:4566` / `host.docker.internal:4566` without `AWS_ACCESS_KEY_ID`.

## Compose

- `infra/compose.yml` — `document-parser:8000`, `${VAR:-}` passthrough (empty → default), `extra_hosts: host.docker.internal:host-gateway` for Floci, `healthcheck` via `curl /health`.
- `infra/compose.load.yml` — `parser + k6` for `make load-test`.
- `infra/compose.prod.yml` — `restart: always` (prod defaults come from `Dockerfile ENV ENV_TYPE=prod`, overridden by compose `ENV_TYPE=${ENV_TYPE:-dev}` in dev).

## Dockerfile

Builder (`python:3.11-slim` + `poetry export`) → Runtime (`gcc libpq-dev curl libmagic1`, `PROMETHEUS_MULTIPROC_DIR`, non-root `appuser`, `ENV_TYPE=prod` secure default, `EXPOSE 8000`).

## Floci local prod test

```bash
ENV_TYPE=prod AWS_REGION=ap-south-1 AWS_ENDPOINT_URL=http://host.docker.internal:4566 \
  docker compose --env-file infra/.env.example -f infra/compose.yml config
```

## Legacy

`app.core.config: Settings` eager singleton → `app.core.config: get_settings()` + lazy `settings` proxy. `CONFIG_SOURCE` / `NODE_ENV` envs still resolved with warning. `OTEL_EXPORTER_OTLP_ENDPOINT` and `PROMETHEUS_MULTIPROC_DIR` previously read via `os.getenv` outside `Settings`; now canonical via `Settings` with env fallback.
