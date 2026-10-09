# Inference

Stateless Python gRPC service that runs dual ONNX models (Spark TF-IDF + Flare BERT) via batching proxy and chunked document analysis. No DB — JWT/`x-api-key` auth, server-streaming progress, health watchtower and per-model isolation.

## Overview

Stateless service exposing `AIService` (`protos/ai_service.proto`) with `Detect` (unary) and `AnalyzeDocument` (server-streaming `started` → `progress` → `final`). Handles `50k` char input, `256` token chunks with `192` stride, `10k` global token cap, via `ThreadPool` batching and weighted aggregation. Isolated `spark-pool`/`flare-pool` executors prevent slow-model starvation.

```text
gRPC unary         Detect(text, model_id)          -> PredictResponse
gRPC server-stream AnalyzeDocument(text, model_id) -> stream AnalyzeDocumentEvent
                   (started -> progress* -> final)
```

## Packages

| Package | Purpose |
|---|---|
| `grpcio`, `grpcio-tools`, `grpcio-health-checking`, `protobuf` | gRPC server, health, codegen |
| `onnxruntime` / `onnxruntime-gpu` | ONNX inference (CPU base, GPU via `compose.gpu.yml`) |
| `transformers`, `huggingface-hub` | Flare BERT tokenizer + HF download (`tokenizers` comes in transitively) |
| `scikit-learn`, `numpy` | Spark TF-IDF vectorizer (`scipy` comes in transitively) |
| `pydantic`, `pydantic-settings` | Typed config + validation |
| `prometheus-client` | Metrics (`:8333`) |
| `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation-grpc` | Tracing |
| `structlog` | JSON structured logging |
| `PyJWT` | JWT auth |
| `boto3`, `python-dotenv` | AWS Secrets Manager/SSM (prod), `.env` loading (dev) |
| `pytest`, `pytest-asyncio`, `pytest-cov`, `coverage`, `ruff` | Tests/lint |

See `pyproject.toml` for full list.

## Architecture

```mermaid
graph LR
    Client --> GRPC[GRPCServer :50051]
    GRPC --> Mon[MonitoringInterceptor]
    Mon --> Auth[AuthInterceptor]
    Auth --> Svc[AIService Servicer]
    Svc --> DAS[DocumentAnalysisService]
    DAS --> Prep[TextPreparationPipeline]
    Prep --> Planner[ChunkPlanner spark/flare]
    DAS --> Disp[ConcurrencyDispatcher worker pool 8]
    Disp --> BP_S[BatchingProxy spark]
    Disp --> BP_F[BatchingProxy flare]
    BP_S --> Eng_S[SparkEngine ONNX]
    BP_F --> Eng_F[FlareEngine ONNX]
    Eng_S --> Loader[HuggingFaceLoader cache]
    Eng_F --> Loader
    GRPC --> Health[HealthMonitor watchtower 5s]
    Health --> Metrics[Prometheus :8333]
```

Per-model isolation prevents slow-model starvation; see [Architecture](docs/concepts/architecture.md) for ports, startup DAG and class view.

## Configuration

```ini
ENV_TYPE=dev  # dev = compose .env, prod = AWS Secrets Manager + SSM
# required
API_KEY=dev-secret-key-16chars-at-least   # >=16 chars (prod: detectai/inference/secrets)
# optional (defaults, see docs/getting-started/configuration.md for full reference)
GRPC_PORT=50051
METRICS_PORT=8333
BATCH_SIZE=32
BATCH_TIMEOUT=0.05
# SPARK_BATCH_SIZE=32  SPARK_BATCH_TIMEOUT=0.05  # optional per-model overrides
# FLARE_BATCH_SIZE=32  FLARE_BATCH_TIMEOUT=0.05  # (fall back to BATCH_* when unset)
MAX_TEXT_CHARS=50000
CHUNK_TOKEN_LIMIT=256
CHUNK_TOKEN_STRIDE=192
INFERENCE_PROVIDERS=CPUExecutionProvider
# HF_TOKEN=hf_...  # optional, for private HF repos (prod: same secret)
```

See `infra/.env.example` and `docs/getting-started/configuration.md` for all vars and validation rules.

## API

```text
gRPC  AIService/Detect              (PredictRequest)  -> PredictResponse
gRPC  AIService/AnalyzeDocument      (AnalyzeDocumentRequest) -> stream AnalyzeDocumentEvent
gRPC  grpc.health.v1.Health/Check    -> SERVING / NOT_SERVING
GET   :8333/metrics                  -> Prometheus
```

`model_id` is `spark|flare` case-insensitive, truncated to `64`, default `spark`. See `docs/components/api.md` for full proto and status codes (`OK`, `INVALID_ARGUMENT`, `RESOURCE_EXHAUSTED`, `UNAUTHENTICATED` etc).

## Observability

Logs are JSON to stdout (one `event` key per line). Tracing is OTel if `OTEL_EXPORTER_OTLP_ENDPOINT` is set, and disabled otherwise. Prometheus scrapes `GET :8333/metrics`.

Key metric families:

- `grpc_requests_total`, `grpc_latency_seconds`, `grpc_auth_failures_total` — request traffic and auth rejections
- `model_batch_size`, `model_batch_queue_size`, `model_batch_queue_wait_seconds`, `model_batch_processing_seconds` — batching health
- `inference_document_chunks_processed_total`, `inference_document_chunks_failed_total` — per-chunk success
- `inference_service_health_status`, `inference_engine_health_status` — health watchtower state

See `docs/operations/observability.md` for the full metric list, sample log entries and PromQL alert rules.

## Testing

All test commands are wrapped with `make` and must be run from `services/inference` — check `Makefile` for details.

```bash
cd services/inference

# Run unit tests (also runs `make proto` to regenerate gRPC stubs;
# src/generated/ is gitignored and rebuilt every time)
make test

# Run tests with coverage report
make test-coverage

# Run integration tests
make test-integration

# Regenerate stubs after editing protos/ai_service.proto
make proto
```

See `docs/testing/overview.md` and `load/README.md` for load scenarios.

## Docker

All Docker commands are wrapped with `make` for simplicity and run from `services/inference`.

```bash
# Build the inference image
make inference-build

# Start the service locally on CPU (default)
make inference-up

# Start with GPU acceleration (uses CUDA)
make inference-up GPU=1

# View live logs and running containers
make inference-logs
make inference-ps

# Stop the service
make inference-down
```

See `docs/concepts/architecture.md` for compose files and `infra/` details.

## Documentation

| Guide | What |
|---|---|
| [Quick Start](docs/getting-started/quickstart.md) | Get the service running in minutes |
| [Architecture](docs/concepts/architecture.md) | How the service is built and why |
| [Request Flows](docs/concepts/request-flows.md) | How requests move through the system |
| [Chunking](docs/concepts/chunking.md) | How text is split into chunks |
| [Batching](docs/concepts/batching.md) | How requests are batched for efficiency |
| [API Reference](docs/components/api.md) | How to call the service |
| [Authentication](docs/components/auth.md) | How authentication works |
| [Models](docs/components/models.md) | How ML models are loaded and used |
| [Health](docs/components/health.md) | Health checks and monitoring |
| [Configuration](docs/getting-started/configuration.md) | All settings and how to configure them |
| [Observability](docs/operations/observability.md) | Metrics, logs, and alerts |
| [Testing](docs/testing/overview.md) | How to test the service |

Full index: [docs/README.md](docs/README.md).
