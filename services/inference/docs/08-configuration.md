# Configuration

Full reference for `src/infrastructure/config/` + `infra/.env.example`. Mirrors `services/payments/gateway` and `services/workers` (`ENV_TYPE=dev|prod` + AWS).

## Env Type (dev vs prod)

| Var | Default | Notes |
|---|---|---|
| `ENV_TYPE` | `dev` | Canonical switch. `dev` = local docker-compose with `.env` / `ENV_FILE`; `prod` = AWS Secrets Manager + SSM. |
| `ENV` *(deprecated)* | — | Legacy alias: `production→prod`, `development/test→dev` + warning. Use `ENV_TYPE`. |
| `CONFIG_SOURCE` *(deprecated)* | — | Workers parity: `aws/prod→prod`, `env/dev→dev`. |
| `NODE_ENV` | — | Fallback only: `production→prod`, `test→dev`. |

`provider.resolve_env_type()` checks `ENV_TYPE` first, then deprecated aliases, then `NODE_ENV`, defaulting to `dev`. Must be `dev|prod` or startup fails.

### Dev mode (`ENV_TYPE=dev`)

```bash
cp infra/.env.example infra/.env   # or export in shell (shell wins)
ENV_TYPE=dev
API_KEY=dev-secret-key-16chars-at-least
INFERENCE_PROVIDERS=CPUExecutionProvider
# Loads .env via python-dotenv if present, else ENV_FILE if set
```

- Reads `.env` in CWD if exists, else `ENV_FILE` if set (like gateway/workers).
- Applies dev defaults: `OTEL_SERVICE_NAME=inference`, `AWS_REGION=ap-south-1`.
- No AWS calls; validation is local only.

### Prod mode (`ENV_TYPE=prod`)

```bash
ENV_TYPE=prod
AWS_REGION=ap-south-1
# Secrets Manager: detectai/inference/secrets {API_KEY, HF_TOKEN}
# SSM: /detectai/inference/*  (GRPC_PORT, BATCH_*, OTEL_*, etc.)
# Override names via INFERENCE_SECRETS_NAME / SSM_PREFIX / AWS_ENDPOINT_URL
```

Flow (same as gateway `provider.go:27-62`):

1. `load_from_aws()` — Secrets Manager JSON `{API_KEY, HF_TOKEN}` (missing in prod → fatal) + SSM `GetParametersByPath(/detectai/inference/, Recursive, WithDecryption)` paginated. Env/previously-set `cfg` wins over AWS for SSM (env > AWS).
2. `load_prod_non_secret_overrides()` — fills only non-secrets (`GRPC_PORT`, `BATCH_*`, `LOG_LEVEL`, `OTEL_*`, `HF_TOKEN` already from secret) from `process.env` if AWS didn't set them. Secrets **never** from env in prod.
3. `Settings(**merged)` — pydantic validation.
4. `validate_prod_strict()` — rejects dev fallback keys (`dev-secret`, `test-secret`, `mock-`, `change-me`), requires `AWS_REGION` and `API_KEY` from AWS.

Precedence: `process.env` (for SSM skip) > `cfg` (AWS) > `load_prod_non_secret_overrides` > Settings defaults (zod defaults equivalent).

## Env Table (canonical only)

| Var | Default | Range | Notes |
|---|---|---|---|
| `API_KEY` | *(required)* | `>=16` chars | HMAC/JWT secret. Prod via `detectai/inference/secrets`. Compose bridges `AI_SERVICE_API_KEY` as fallback with warning. |
| `HF_TOKEN` | *(empty)* | `string` | Optional Hugging Face token for private `kpisolkar24/detect-ai-*` repos. Prod via secret. If empty, anonymous public download + offline-cache fallback. |
| `ENV_TYPE` | `dev` | `dev|prod` | — |
| `LOG_LEVEL` | `INFO` | `DEBUG/INFO/WARNING/ERROR/CRITICAL` | Validated (`WARN→WARNING`). Controls `structlog` + root logger (no silent fallback). |
| `GRPC_PORT` | `50051` | `1..65535` | `GRPCServer` (`add_insecure_port`). |
| `GRPC_MAX_WORKERS` | `50` | `1..500` | `maximum_concurrent_rpcs`. |
| `METRICS_PORT` | `8333` | `1..65535` | `prometheus_client`. |
| `MODEL_CACHE_DIR` | `./models` | `path` | `HuggingFaceLoader` cache, created if missing. Mount as volume/EBS in prod to avoid re-download. |
| `SPARK_MODEL_REVISION` | `9a48004391c71272d6fb1d164ed7c56e1fbfe360` | 40-char lowercase SHA | Pinned HF revision, validated `^[0-9a-f]{40}$`. |
| `FLARE_MODEL_REVISION` | `e1911c0be59f4e10f0d120f639d1358e46bc2086` | 40-char SHA | — |
| `BATCH_SIZE` | `32` | `1..512` | per `BatchingProxy`, `<= BATCH_QUEUE_MAX_SIZE`. |
| `BATCH_TIMEOUT` | `0.05` | `0..10` sec | batch linger. |
| `BATCH_QUEUE_MAX_SIZE` | `1024` | `1..10000` | `asyncio.Queue` maxsize. |
| `INFERENCE_MAX_WORKERS` | `32` | `1..128` | `ThreadPoolExecutor` total, `>= MAX_CONCURRENT_BATCHES`. |
| `MAX_CONCURRENT_BATCHES` | `4` | `1..32` | semaphore for concurrent ONNX runs. |
| `MAX_INFLIGHT_DOC_CHUNKS` | `8` | `1..64` | `ConcurrencyDispatcher` semaphore. |
| `MAX_TEXT_CHARS` | `50000` | `1..200000` | Input char cap (canonical; `MAX_TEXT_LENGTH` alias dropped). |
| `MAX_GLOBAL_TOKENS` | `10000` | `1..100000` | `>= CHUNK_TOKEN_LIMIT`. |
| `CHUNK_TOKEN_LIMIT` | `256` | `1..2048` | sliding window. |
| `CHUNK_TOKEN_STRIDE` | `192` | `1..2048` | `<= LIMIT`. |
| `INFERENCE_PROVIDERS` | `CPUExecutionProvider` | allow-list | comma or JSON array. Allowed: `CPUExecutionProvider`, `CUDAExecutionProvider`, `TensorrtExecutionProvider`, `ROCMExecutionProvider`, `OpenVINOExecutionProvider`. GPU compose defaults to `CUDAExecutionProvider,CPUExecutionProvider`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | `url` | if empty, tracing disabled (fail-open). |
| `OTEL_SERVICE_NAME` | `inference` | `string` | OTel `service.name`. |
| `OTEL_SERVICE_VERSION` | `0.1.0` | `string` | OTel `service.version` (alias `SERVICE_VERSION`). |
| `AWS_REGION` | `ap-south-1` | `string` | Required in prod. |
| `AWS_ENDPOINT_URL` | *(empty)* | `url` | LocalStack/Floci override (`*:4566` injects `test/test` creds if no `AWS_ACCESS_KEY_ID`). |
| `SSM_PREFIX` | `/detectai/inference/` | `path` | Override via `SSM_PREFIX` or `SSM_PARAM_PREFIX`. |
| `SSM_ENABLED` | `true` | `0|false` = disable SSM | Opt-out flag. |
| `INFERENCE_SECRETS_NAME` | `detectai/inference/secrets` | `string` | Override via `INFERENCE_SECRETS_NAME` or `INFERENCE_SECRETS_ARN`. |

Dropped (breaking — removed): legacy `ENV`, `INFERENCE_MODEL_CACHE_DIR`, `INFERENCE_BATCH_*`, `INFERENCE_MAX_*`, `INFERENCE_SPARK/FLARE_REVISION`, `INFERENCE_GRPC_MAX_WORKERS`, `PORT_INFERENCE*`, `MAX_TEXT_LENGTH` alias, lowercase `detect_ai_network`. Server now reads canonical names only; compose interpolates same name (e.g. `- BATCH_SIZE=${BATCH_SIZE:-32}`).

## Validation

```python
# Settings (src/infrastructure/config/settings.py)
assert ENV_TYPE in {"dev", "prod"}
assert LOG_LEVEL in {"DEBUG","INFO","WARNING","ERROR","CRITICAL"}
assert len(API_KEY) >= 16
assert INFERENCE_PROVIDERS ⊆ KNOWN_PROVIDERS
assert SPARK/FLARE_REVISION ~= ^[0-9a-f]{40}$
# cross-field (model_validator):
assert CHUNK_TOKEN_STRIDE <= CHUNK_TOKEN_LIMIT
assert MAX_GLOBAL_TOKENS >= CHUNK_TOKEN_LIMIT
assert BATCH_QUEUE_MAX_SIZE >= BATCH_SIZE
assert INFERENCE_MAX_WORKERS >= MAX_CONCURRENT_BATCHES
# prod-strict (provider.py):
assert "dev-secret" not in API_KEY.lower()  # prod must not use dev fallback
assert AWS_REGION != ""
```

`Settings` uses `extra="ignore"`, `populate_by_name=True`, cached via `lru_cache(get_settings)` (clear with `clear_settings_cache()` in tests). No `env_file` in `Settings`; dotenv is handled by `provider` (dev only). Backwards-compat `from src.infrastructure.config import settings` is now a lazy proxy — prefer `get_settings()` DI.

## AWS (prod)

- **Secret** `detectai/inference/secrets` (JSON): `{"API_KEY":"...16+...","HF_TOKEN":"hf_..."}` — override via `INFERENCE_SECRETS_NAME`. Single secret mirrors `gateway: detectai/gateway/secrets` pattern.
- **SSM** prefix `/detectai/inference/` — keys are uppercased with `-→_` (e.g. SSM `/detectai/inference/batch-size` → `BATCH_SIZE`). Paginated `WithDecryption`. Env/AWS-cfg wins over SSM. Disable with `SSM_ENABLED=0`.
- **Region / endpoint**: default `ap-south-1`; `AWS_ENDPOINT_URL` for LocalStack/Floci (`http://host.docker.internal:4566`). Floci dummy creds `test/test` only when endpoint is `*:4566` and no `AWS_ACCESS_KEY_ID`.
- **IAM**: standard AWS SDK chain (env, shared config, IMDS/IRSA). No hardcoded creds.
- **Terraform**: no `detectai/inference/*` module ships — create via `aws secretsmanager create-secret --name detectai/inference/secrets --secret-string '{"API_KEY":"...","HF_TOKEN":"..."}'` and `aws ssm put-parameter --name /detectai/inference/log-level --value INFO` or add a `modules/inference-secrets` mirroring `modules/mq/main.tf`.

## Compose

* `infra/compose.yml` (`Dockerfile.local`, CPU) — passes canonical vars with same-name defaults, bridges `API_KEY=${API_KEY:-${AI_SERVICE_API_KEY:?required}}`, ports `${GRPC_PORT}:${GRPC_PORT}`, network `${DETECT_AI_NETWORK:-detect-ai-network}`, includes `HF_TOKEN`, `OTEL_*`, `AWS_*`, `SSM_*` for prod-AWS injection.
* `infra/compose.gpu.yml` — overrides `Dockerfile` (CUDA) + `INFERENCE_PROVIDERS=CUDAExecutionProvider,CPUExecutionProvider` (was hardcoded single) + `deploy.resources` + `nvidia`.
* `infra/compose.prod.yml` — `restart: always` only (secrets come from AWS, not compose).
* `infra/compose.load.yml` — `ENV_TYPE=dev`, canonical names, `k6` isolated on `loadnet`, smaller defaults (`BATCH_SIZE=8`, `GRPC_MAX_WORKERS=10`).
* `Dockerfile` / `Dockerfile.local` — `ENV ENV_TYPE=prod` so bare ECS/EC2 defaults to secure path; compose overrides to `dev` locally (matches workers `Dockerfile:44`).

See `../README.md` for quickstart and `09-api.md` for proto limits.
