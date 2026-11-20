# Configuration

Every setting is resolved once at boot into a typed `Settings` object. A malformed value falls back to its default or fails the boot — the service never starts with a half-read config.

## The two planes

`ENV_TYPE=prod` selects prod; anything else selects dev. The choice comes from the process environment and never from a file.

| Plane | Source | Notes |
| --- | --- | --- |
| dev | `infra/.env` (dotenv), env vars win | reflection on, local artifact cache, no AWS calls |
| prod | Secrets Manager `detectai/inference/secrets` + SSM `/detectai/inference/` | requires `AWS_REGION`; a key seeded on both planes fails the boot |

`infra/.env.example` is the dev template. Secrets stay in the seeded plane; see [Secrets](../guides/secrets.md). The full resolution rules are in [specification/references/config.md](../../specification/references/config.md).

## Knobs by group

### Transport and admission

| Env key | Default | Meaning |
| --- | --- | --- |
| `GRPC_PORT` | `50051` | bind port; unreadable values fall back |
| `API_KEY` | — | required, at least 16 chars; `x-api-key` must match |
| `LOG_LEVEL` | `INFO` | DEBUG/INFO/WARNING/ERROR/CRITICAL |
| `MAX_TEXT_CHARS` | `1000000` | over-limit text is rejected, never truncated |
| `MAX_INFLIGHT_REQUESTS` | `8` | server-wide concurrent RPC ceiling |

### Chunking and verdicts

| Env key | Default | Meaning |
| --- | --- | --- |
| `CHUNK_TOKEN_LIMIT` | `512` | total tokens per chunk, special tokens included |
| `CHUNK_TOKEN_OVERLAP` | `0` | tokens of preceding context carried per chunk |
| `AI_DETECTION_THRESHOLD` | `0.5` | weighted mean at or above this reads as AI |

### Batching and concurrency

| Env key | Default | Meaning |
| --- | --- | --- |
| `INFERENCE_BATCH_SIZE` | `8` | widest call the engine accepts |
| `FLARE_BATCH_SIZE` / `SPARK_BATCH_SIZE` | unset | per-model override of the global width |
| `MAX_CONCURRENT_BATCHES` | `2` | engine pool width **and** per-model admission permit |
| `ORT_INTRA_OP_THREADS` | `0` | `0` leaves ONNX Runtime's default |

### Models

| Env key | Default | Meaning |
| --- | --- | --- |
| `ENABLED_MODELS` | `spark` | `spark`, `flare`, or both; canonical order |
| `MODEL_CACHE_DIR` | `./models` | local artifact root, mount a volume to keep it |
| `FLARE/SPARK_MODEL_REPO` | pinned repos | Hugging Face repo ids |
| `FLARE/SPARK_MODEL_REVISION` | pinned SHAs | full 40-char git SHAs, verified on disk |
| `FLARE/SPARK_MODEL_DIR` | `onnx/fp32`, `onnx/fp16` | in-repo artifact directory |
| `FLARE/SPARK_MAX_SEQUENCE_LENGTH` | `512` | configured ceiling, cross-checked against the artifact |
| `INFERENCE_PROVIDERS` | `CPUExecutionProvider` | ordered ORT providers; a missing one fails the boot |

### Telemetry

| Env key | Default | Meaning |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | the gate: unset installs no telemetry at all |
| `NEW_RELIC_LICENSE_KEY` | unset | required when the endpoint is set; at least 16 chars |
| `OTEL_SERVICE_NAME` | `inference` | resource service name |
| `OTEL_SERVICE_VERSION` | unset | resource version, `dev` when unset |
| `OTEL_TRACE_SAMPLE_RATIO` | `1.0` | in `(0, 1]` |

## Numeric bounds

| Bound | Default | Failure behavior |
| --- | --- | --- |
| API key length | 16 | boot fails on a short key |
| Text length | 1,000,000 chars | `INVALID_ARGUMENT` |
| Chunk window | 512 total | clamped to the model ceiling; below 64 fails the boot |
| Overlap | 0 tokens | must leave at least one content token |
| Batch width | 8 sequences | a wider call raises `EngineError` → `INTERNAL` |
| Threshold | `[0, 1]` | out-of-range falls back to 0.5 |

## CPU and GPU

The `cpu` image is the default. The `gpu` image swaps in `onnxruntime-gpu` and sets `INFERENCE_PROVIDERS` to a CUDA-first list; `compose.gpu.yml` reserves the device. Because the loader verifies that every requested provider is effective, a missing CUDA device fails the boot rather than silently falling back to CPU. See [Models and artifacts](../concepts/models.md).

## Next

- **[Quick Start](quickstart.md)** — boot with these values.
- **[Testing](../guides/testing.md)** — run the suites.
- **[Make targets](../reference/make.md)** — the commands.
