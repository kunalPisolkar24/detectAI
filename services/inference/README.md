# Inference

Stateless Python gRPC service that runs dual ONNX models (Spark TF-IDF + Flare BERT) via batching proxy and chunked document analysis. No DB — JWT/`x-api-key` auth, server-streaming progress, health watchtower and per-model isolation.

## Overview

Stateless service exposing `AIService` (`protos/ai_service.proto`) with `Detect` (unary) and `AnalyzeDocument` (server-streaming `started` → `progress` → `final`). Handles `50k` char input, `256` token chunks with `192` stride, `10k` global token cap, via `ThreadPool` batching and weighted aggregation. Isolated `spark-pool`/`flare-pool` executors prevent slow-model starvation.

```text
POST gRPC  Detect(text, model_id)          -> PredictResponse
POST gRPC  AnalyzeDocument(text, model_id) -> stream AnalyzeDocumentEvent
```

## Packages

| Package | Purpose |
|---|---|
| `grpcio`, `grpcio-tools`, `grpcio-health-checking`, `protobuf` | gRPC server, health, codegen |
| `onnxruntime` / `onnxruntime-gpu` | ONNX inference (CPU base, GPU via `compose.gpu.yml`) |
| `transformers`, `huggingface-hub`, `tokenizers` | Flare BERT tokenizer + HF download |
| `scikit-learn`, `scipy`, `numpy` | Spark TF-IDF vectorizer |
| `pydantic`, `pydantic-settings` | Typed config + validation |
| `prometheus-client` | Metrics (`:8333`) |
| `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation-grpc` | Tracing |
| `structlog` | JSON structured logging |
| `PyJWT`, `circuitbreaker` | JWT auth, resilience |
| `pytest`, `pytest-asyncio`, `pytest-cov`, `coverage`, `ruff` | Tests/lint |

See `pyproject.toml` for full list.

## Architecture

```mermaid
graph LR
    Client --> GRPC[GRPCServer :50051]
    GRPC --> Auth[AuthInterceptor]
    Auth --> Mon[MonitoringInterceptor]
    Mon --> Svc[AIService Servicer]
    Svc --> DAS[DocumentAnalysisService]
    DAS --> Prep[TextPreparationPipeline]
    Prep --> Planner[ChunkPlanner spark/flare]
    DAS --> Disp[ConcurrencyDispatcher max_inflight 8]
    Disp --> BP_S[BatchingProxy spark]
    Disp --> BP_F[BatchingProxy flare]
    BP_S --> Eng_S[SparkEngine ONNX]
    BP_F --> Eng_F[FlareEngine ONNX]
    Eng_S --> Loader[HuggingFaceLoader cache]
    Eng_F --> Loader
    GRPC --> Health[HealthMonitor watchtower 5s]
    Health --> Metrics[Prometheus :8333]
```

Per-model isolation prevents slow-model starvation; see [Architecture](docs/01-architecture.md) for ports, startup DAG and class view.

## Configuration

```ini
# required
API_KEY=dev-secret-key-16chars-at-least   # >=16 chars, also AI_SERVICE_API_KEY
# optional (defaults, see docs/08-configuration.md for full reference)
GRPC_PORT=50051
METRICS_PORT=8333
BATCH_SIZE=32
BATCH_TIMEOUT=0.05
MAX_TEXT_CHARS=50000
CHUNK_TOKEN_LIMIT=256
CHUNK_TOKEN_STRIDE=192
INFERENCE_PROVIDERS=CPUExecutionProvider
```

See `infra/.env.example` and `docs/08-configuration.md` for all vars and validation rules.

## API

```text
gRPC  AIService/Detect              (PredictRequest)  -> PredictResponse
gRPC  AIService/AnalyzeDocument      (AnalyzeDocumentRequest) -> stream AnalyzeDocumentEvent
gRPC  grpc.health.v1.Health/Check    -> SERVING / NOT_SERVING
GET   :8333/metrics                  -> Prometheus
```

`model_id` is `spark|flare` case-insensitive, truncated to `64`, default `spark`. See `docs/09-api.md` for full proto and status codes (`OK`, `INVALID_ARGUMENT`, `RESOURCE_EXHAUSTED`, `UNAUTHENTICATED` etc).

## Observability

Logs are JSON to stdout. Tracing is OTel if an OTLP endpoint is set. Metrics at GET /metrics for Prometheus.

Metrics configured:

- gRPC requests total — counts every request by method, code and model
- gRPC auth failures — counts rejected requests by method and reason
- Batch queue size and batch processing time — track batching health
- Document chunks processed and failed — track per-chunk success

Alerts configured:

- Inference down — service not up for more than 2 minutes
- High error rate — error rate above 5% for 5 minutes
- Queue full — engine queue full for more than 1 minute

See `docs/10-observability.md` for full metric list and PromQL.

## Testing

All test commands are wrapped with `make` — check `Makefile` for details.

```bash
# Generate gRPC code from proto
make proto

# Run unit tests
make test

# Run tests with coverage report
make test-coverage

# Run integration tests
make test-integration
```

See `docs/11-testing.md` and `load/README.md` for load scenarios.

## Docker

All Docker commands are wrapped with `make` for simplicity.

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

See `docs/01-architecture.md` for compose files and `infra/` details.

## Documentation

| Guide | What |
|---|---|
| [Architecture](docs/01-architecture.md) | High-level, hexagonal ports, startup DAG, class view |
| [Request Flows](docs/02-request-flows.md) | Detect and AnalyzeDocument sequences with error branches |
| [Authentication](docs/03-auth.md) | JWT and `x-api-key` flow, bypasses, failure metrics |
| [Chunking & Aggregation](docs/04-chunking.md) | Tokenizers, sliding window, highlight sweep |
| [Batching Internals](docs/05-batching.md) | Queue, worker loop, semaphore, shutdown |
| [Model Loading](docs/06-models.md) | HF download, retries, provider verification |
| [Health](docs/07-health.md) | Watchtower, queue-full vs not-serving |
| [Configuration](docs/08-configuration.md) | Full env reference and validation |
| [API](docs/09-api.md) | Full proto, endpoints, status codes |
| [Observability](docs/10-observability.md) | Metrics, dashboards, alerts |
| [Testing](docs/11-testing.md) | Unit, integration, load matrix |

Full index: [docs/README.md](docs/README.md).
