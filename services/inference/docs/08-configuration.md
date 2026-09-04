# Configuration

Full reference for `src/infrastructure/config.py` + `infra/.env.example`.

## Env table

| Var | Default | Range | Notes |
|---|---|---|---|
| `API_KEY` | *(required)* | `>=16` chars | Also `AI_SERVICE_API_KEY`; non-empty string |
| `ENV` | `production` | `string` | — |
| `LOG_LEVEL` | `INFO` | `DEBUG/INFO/WARN/ERROR` | controls `structlog` + root logger |
| `GRPC_PORT` | `50051` | `1..65535` | `GRPCServer` |
| `GRPC_MAX_WORKERS` | `50` | `1..500` | `maximum_concurrent_rpcs` |
| `METRICS_PORT` | `8333` | `1..65535` | `prometheus_client` |
| `MODEL_CACHE_DIR` | `./models` | `path` | `HuggingFaceLoader` cache, created if missing |
| `SPARK_MODEL_REVISION` | `9a48004391c71272d6fb1d164ed7c56e1fbfe360` | 40-char lowercase SHA | — |
| `FLARE_MODEL_REVISION` | `e1911c0be59f4e10f0d120f639d1358e46bc2086` | 40-char SHA | — |
| `BATCH_SIZE` | `32` | `1..512` | per `BatchingProxy`, `<= BATCH_QUEUE_MAX_SIZE` |
| `BATCH_TIMEOUT` | `0.05` | `0..10` sec | batch linger |
| `BATCH_QUEUE_MAX_SIZE` | `1024` | `1..10000` | `asyncio.Queue` maxsize |
| `INFERENCE_MAX_WORKERS` | `32` | `1..128` | `ThreadPoolExecutor` total, `>= MAX_CONCURRENT_BATCHES` |
| `MAX_CONCURRENT_BATCHES` | `4` | `1..32` | semaphore for concurrent ONNX runs |
| `MAX_INFLIGHT_DOC_CHUNKS` | `8` | `1..64` | `ConcurrencyDispatcher` semaphore |
| `MAX_TEXT_CHARS` | `50000` | `1..200000` | alias `MAX_TEXT_LENGTH` via `AliasChoices` |
| `MAX_GLOBAL_TOKENS` | `10000` | `1..100000` | `>= CHUNK_TOKEN_LIMIT` |
| `CHUNK_TOKEN_LIMIT` | `256` | `1..2048` | sliding window |
| `CHUNK_TOKEN_STRIDE` | `192` | `1..2048` | `<= LIMIT` |
| `INFERENCE_PROVIDERS` | `CPUExecutionProvider` (compose) / `CUDA...` (gpu) | allow-list | comma or JSON array |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(empty)* | `url` | if empty, tracing disabled |
| `OTEL_SERVICE_NAME` | `inference` | `string` | — |
| `PORT_INFERENCE` | `50051` | `port` | compose publish |
| `PORT_INFERENCE_METRICS` | `8333` | `port` | compose publish |

## Validation

```python
# field_validator INFERENCE_PROVIDERS must be allow-listed
# field_validator revisions must be ^[0-9a-f]{40}$
# model_validator:
assert CHUNK_TOKEN_STRIDE <= CHUNK_TOKEN_LIMIT
assert MAX_GLOBAL_TOKENS >= CHUNK_TOKEN_LIMIT
assert BATCH_QUEUE_MAX_SIZE >= BATCH_SIZE
assert INFERENCE_MAX_WORKERS >= MAX_CONCURRENT_BATCHES
```

`Settings` uses `extra="ignore"`, `populate_by_name=True`, cached via `lru_cache`. Import without env falls back to lazy proxy for tests.

## Compose

* `infra/compose.yml` sets `API_KEY=${AI_SERVICE_API_KEY:?required}`, `healthcheck grpc_health_probe`, `ports 50051/8333`, `network detectai_net`, `INFERENCE_PROVIDERS=CPUExecutionProvider`.
* `infra/compose.gpu.yml` overrides to `Dockerfile` + `CUDAExecutionProvider` + `deploy.resources.limits 16G/8CPU` + `nvidia` device.
* `infra/compose.load.yml` uses smaller defaults (`BATCH_SIZE=8`, `GRPC_MAX_WORKERS=10`) for load test isolation.

See `../README.md` for quickstart and `09-api.md` for proto limits.
