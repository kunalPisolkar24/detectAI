# Inference

Stateless Python gRPC service that runs dual ONNX models (Spark TF-IDF + Flare BERT) via batching proxy and chunked document analysis. No DB — JWT/`x-api-key` auth, server-streaming progress, health watchtower and per-model isolation.

## Overview

Stateless service exposing gRPC `AIService` (`protos/ai_service.proto`) with `Detect` (unary) and `AnalyzeDocument` (server-streaming `started` → `progress` → `final`). Handles `50k` char input, `256` token chunks with `192` stride, `10k` global token cap, via `ThreadPool` batching and weighted aggregation. Isolated `spark-pool`/`flare-pool` executors prevent slow-model starvation.

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

See `pyproject.toml` for full list and `poetry.lock` pins.

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
    Mon --> Metrics
```

```mermaid
graph TB
    subgraph Ports[Hexagonal Ports]
        IAsync[IAsyncInferenceEngine async predict]
        ISync[ISyncBatchInferenceEngine predict_batch]
        HealthR[IEngineHealthReporter health_snapshot]
        LoaderP[IModelLoader load]
        Telem[ITelemetryReporter observe/track]
    end
    Ports --> App[Application Services]
    App --> Adapters[Adapters Outbound]
    Adapters --> Infra[Infrastructure]
```

```mermaid
graph TB
    Main[main.py] --> Trace[setup_tracing OTLP]
    Main --> MetricsStart[start_http_server :8333]
    Main --> ExecS[spark-pool max 4..16]
    Main --> ExecF[flare-pool max 4..16]
    Main --> Loader2[HuggingFaceLoader]
    Loader2 --> SparkRes[(spark ONNX + pickle tokenizer)]
    Loader2 --> FlareRes[(flare ONNX + BertTokenizerFast)]
    SparkRes --> SparkRaw[SparkEngine]
    FlareRes --> FlareRaw[FlareEngine max_length 256]
    SparkRaw --> BPS[BatchingProxy spark 32/0.05s]
    FlareRaw --> BPF[BatchingProxy flare 32/0.05s]
    BPS --> DAS2[DocumentAnalysisService]
    BPF --> DAS2
    DAS2 --> GRPC2[GRPCServer Monitoring->Auth]
```

- Per-model isolation via `src/main.py:41` (`spark_workers = max(4, workers//2)`, `flare_workers = max(4, workers-flare)`).
- `BatchingProxy` per model (`queue 1024`, `batch 32`, `timeout 0.05s`, `max_concurrent_batches 4`) prevents cross-model head-of-line blocking.
- `DocumentAnalysisService` consults `health_snapshot()` before dispatch — `QUEUE_FULL` sheds via `RESOURCE_EXHAUSTED`, not `NOT_SERVING`.

## Request Flow

### Detect (unary)

```mermaid
sequenceDiagram
    participant C as Client
    participant G as GRPCServer
    participant A as AuthInterceptor
    participant M as MonitoringInterceptor
    participant S as AIService
    participant D as DocumentAnalysisService
    participant B as BatchingProxy
    C->>G: Detect(text, model_id)
    G->>A: check x-api-key or Bearer HS256
    alt unauthenticated
        A-->>C: UNAUTHENTICATED
    else authenticated
        G->>M: bind trace_id/user_id
        M->>S: Detect
        S->>D: analyze(text, model_key)
        D->>D: validate(MAX_TEXT_CHARS 50000)
        D->>D: plan chunks(256/192, max_global 10000)
        D->>B: predict per chunk (inflight <=8, 30s timeout)
        B-->>D: float 0..1
        D->>D: aggregate weighted stride + highlight sweep
        D-->>S: DocumentScore
        S-->>C: PredictResponse(label, confidence 0..100, highlight_spans)
        M->>M: observe grpc_requests_total + latency
    end
```

### AnalyzeDocument (server-streaming)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as AIService
    participant D as DocumentAnalysisService
    participant B as BatchingProxy
    C->>S: AnalyzeDocument(text, model_id)
    S->>D: stream(text, model_key, is_active)
    D-->>S: DocumentStarted(total_chars, total_chunks)
    S-->>C: event started
    loop per chunk as_completed (semaphore 8)
        D->>B: predict(chunk.text)
        B-->>D: prob
        D-->>S: DocumentProgress(processed, total)
        S-->>C: event progress (monotonic)
        Note over C,D: check context.done() -> CANCELLED if disconnected
    end
    D->>D: aggregate final DocumentScore
    D-->>S: final Score
    S-->>C: event final PredictResponse
    S-->>C: stream end
```

- Stream order enforced in `servicers.py:94` via `StreamingPresenter` (`is_started`→`build_started`, `is_progress`→`build_progress`, `is_final`→`build_final`); unknown event → `InferenceError`.
- `request_is_active=lambda: not context.done()` guards dispatcher and per-chunk timeout `30s`.

## Authentication

```mermaid
sequenceDiagram
    participant C as Client
    participant A as AuthInterceptor
    participant H as Handler
    C->>A: gRPC metadata {authorization, x-api-key}
    alt x-api-key == API_KEY
        A->>H: bind auth_type=api_key user_id=internal_service
    else Bearer token
        A->>A: strip Bearer, len<=8192
        A->>A: jwt.decode HS256 require exp+sub
        alt valid sub
            A->>H: bind auth_type=jwt user_id=sub
        else expired
            A-->>C: UNAUTHENTICATED Token expired
        else invalid/missing
            A-->>C: UNAUTHENTICATED Invalid or missing Bearer token
        end
    else missing
        A-->>C: UNAUTHENTICATED
    end
```

* `health` (`/grpc.health.v1.Health/Check|Watch`) bypasses auth (`interceptors.py:38`).
* Failures counted via `grpc_auth_failures_total{method, reason}` (`missing_or_invalid_token`, `token_expired`).

## Chunking & Aggregation

```mermaid
graph TB
    Text[Validated Text 50k] --> Tok{tokenizer callable?}
    Tok -->|yes| BERT[BertTokenChunker offset_mapping]
    Tok -->|no| Regex[RegexTokenChunker \\S+]
    BERT --> Win[Sliding window 256/192 max_global 10000 max_chunks 10000]
    Regex --> Win
    Win --> Chunks[List DocumentChunk index/text/token_count/char_start/char_end]
    Chunks --> Disp2[Dispatcher semaphore 8]
    Disp2 --> Probs[probabilities 0..1]
    Probs --> Agg[ResultAggregator weighted]
    Agg --> Score[DocumentScore ai_probability + HighlightSpan sweep]
```

* `ChunkPlanner` (`chunking.py:161`) validates `stride <= chunk_size`, `max_global_tokens >= chunk_size`; fallback single chunk for stripped non-empty text.
* `ResultAggregator` (`aggregation.py:16`) weights `i==0 ? token_count : min(stride, token_count)`; sweep merges adjacent `HighlightSpan` with same label (`AI >=0.5`) via length-weighted probability.

## BatchingProxy Internals

```mermaid
graph TB
    Pred[predict text] --> Check{shutdown/worker alive?}
    Check -->|no| Reject[ServiceOverloaded QUEUE_FULL/worker_unavailable/shutting_down]
    Check -->|yes| Enq[Queue put_nowait PendingPrediction enqueue_time]
    Enq --> Q[(asyncio.Queue 1024)]
    Q --> Worker[worker_loop]
    Worker --> Collect[collect batch 32 or timeout 0.05s]
    Collect --> Filter[filter cancelled futures]
    Filter --> Sem[Semaphore 4 concurrent]
    Sem --> Exec[run_in_executor predict_batch 30s]
    Exec --> Dist[zip results -> futures set_result]
    Worker --> HealthSnap[health_snapshot SERVING, QUEUE_FULL, WORKER_UNAVAILABLE etc]
```

* Metrics: `model_batch_size`, `model_batch_queue_size` gauge, `model_batch_queue_wait_seconds`, `model_batch_processing_seconds` (30s timeout), `inference_batch_queue_rejected_total{reason}`, `inference_batch_errors_total{error_type}`.
* Shutdown: sentinel `_SHUTDOWN_SENTINEL`, drain pending futures with `ServiceOverloaded(shutting_down)`, `active_batches` gather with 35s timeout.

## Model Loading

```mermaid
sequenceDiagram
    participant L as HuggingFaceLoader
    participant HF as HuggingFace Hub
    participant Cache as MODEL_CACHE_DIR
    participant ORT as onnxruntime
    L->>L: log model_download_started repo_id kpisolkar24/detect-ai-spark|flare revision 40-char SHA
    loop 3x transient retry backoff 1s,2s,3s
        L->>HF: hf_hub_download/snapshot_download
        alt success
            L->>Cache: save onnx + tokenizer
        else transient 429/503/timeout
            L->>L: sleep backoff retry
        else 401/403/404
            L-->>L: fail fast
        end
    end
    L->>ORT: InferenceSession(path, providers)
    ORT-->>L: active_providers
    alt requested GPU but active CPU only
        L->>L: record_provider_fallback gpu_missing
    else
        L->>L: log model_loaded
    end
    alt failed -> offline fallback
        L->>HF: snapshot_download local_files_only
        L->>L: record_provider_fallback offline
    end
```

* `RestrictedUnpickler` allows only `sklearn, scipy, numpy, builtins, collections, copyreg` for Spark pickle.
* Provider verification logs `gpu_provider_unavailable_falling_back_to_cpu` and metric `inference_engine_provider_fallback_total`.

## Health

```mermaid
graph TB
    Watch[watchtower 5s] --> Snap[collect health_snapshot per model]
    Snap --> Resolve{any not SERVING?}
    Resolve -->|QUEUE_FULL| Keep[SERVING - transient]
    Resolve -->|other not SERVING| NotServe[NOT_SERVING + failure_reason]
    Resolve -->|all SERVING| Serve[SERVING]
    Serve --> Pub[grpc health Servicer set + set_service_health metric]
    NotServe --> Pub
    Pub --> Gauge[inference_service_health_status + engine_health_status gauges]
```

* `HealthMonitor` (`health.py:17`) publishes `SERVING`/`NOT_SERVING` for `""` and `aidetection.AIService`; `QUEUE_FULL` never flips health — shed via `RESOURCE_EXHAUSTED` in `DocumentAnalysisService:336`.

## Configuration

```ini
# required
API_KEY=dev-secret-key-16chars-at-least   # >=16 chars, also AI_SERVICE_API_KEY
# optional (defaults shown, from src/infrastructure/config.py + infra/.env.example)
ENV=production
LOG_LEVEL=INFO
GRPC_PORT=50051
GRPC_MAX_WORKERS=50
METRICS_PORT=8333
MODEL_CACHE_DIR=./models
SPARK_MODEL_REVISION=9a48004391c71272d6fb1d164ed7c56e1fbfe360  # 40-char SHA
FLARE_MODEL_REVISION=e1911c0be59f4e10f0d120f639d1358e46bc2086  # 40-char SHA
BATCH_SIZE=32                          # 1..512, <= BATCH_QUEUE_MAX_SIZE
BATCH_TIMEOUT=0.05                     # 0..10 sec
BATCH_QUEUE_MAX_SIZE=1024              # 1..10000, >= BATCH_SIZE
INFERENCE_MAX_WORKERS=32               # 1..128, >= MAX_CONCURRENT_BATCHES
MAX_CONCURRENT_BATCHES=4               # 1..32
MAX_INFLIGHT_DOC_CHUNKS=8              # 1..64
MAX_TEXT_CHARS=50000                   # 1..200000 (alias MAX_TEXT_LENGTH)
MAX_GLOBAL_TOKENS=10000                # 1..100000, >= CHUNK_TOKEN_LIMIT
CHUNK_TOKEN_LIMIT=256                  # 1..2048
CHUNK_TOKEN_STRIDE=192                 # 1..2048, <= LIMIT
INFERENCE_PROVIDERS=CPUExecutionProvider # or CUDAExecutionProvider, TensorrtExecutionProvider, etc.
PORT_INFERENCE=50051
PORT_INFERENCE_METRICS=8333
OTEL_EXPORTER_OTLP_ENDPOINT=            # optional, disables tracing if empty
OTEL_SERVICE_NAME=inference             # optional
```

Validation (`config.py:114`): `STRIDE <= LIMIT`, `MAX_GLOBAL_TOKENS >= LIMIT`, `QUEUE_MAX_SIZE >= BATCH_SIZE`, `MAX_WORKERS >= MAX_CONCURRENT_BATCHES`, revisions must be lowercase 40-char hex, providers allow-listed.

## API

Proto: `protos/ai_service.proto` (`package aidetection;`).

```protobuf
syntax = "proto3";
package aidetection;

service AIService {
  rpc Detect (PredictRequest) returns (PredictResponse);
  rpc AnalyzeDocument (AnalyzeDocumentRequest) returns (stream AnalyzeDocumentEvent);
}

message PredictRequest {
  string text = 1;      // up to 50k chars, validated
  string model_id = 2;  // spark | flare, case-insensitive, truncated to 64, default spark
}

message AnalyzeDocumentRequest {
  string text = 1;
  string model_id = 2;
}

message AnalyzeDocumentStarted {
  int32 total_chars = 1;
  int32 total_chunks = 2;
}

message AnalyzeDocumentProgress {
  int32 processed_chunks = 1;
  int32 total_chunks = 2;
}

message AnalyzeDocumentEvent {
  oneof event {
    AnalyzeDocumentStarted started = 1;    // first event
    AnalyzeDocumentProgress progress = 2;  // monotonic, bounded
    PredictResponse final = 3;             // last event
  }
}

message HighlightSpan {
  int32 char_start = 1;
  int32 char_end = 2;
  float ai_confidence = 3;  // 0..100
}

message PredictResponse {
  string model_name = 1;                    // Spark | Flare
  string label = 2;                         // AI | Human
  bool is_ai_generated = 3;
  float confidence_score = 4;               // 0..100
  float human_confidence = 5;               // 0..100
  float ai_confidence = 6;                  // 0..100
  repeated HighlightSpan highlight_spans = 7;
}
```

### Endpoints

| Method | Request | Response | Notes |
|---|---|---|---|
| `grpc.health.v1.Health/Check` | `HealthCheckRequest` | `SERVING` / `NOT_SERVING` | Bypass auth, `Watch` also supported. Health watchtower 5s. |
| `GET :8333/metrics` | — | Prometheus text | `prometheus_client` scrape. |
| `AIService/Detect` | `PredictRequest(text, model_id)` | `PredictResponse` | Unary. |
| `AIService/AnalyzeDocument` | `AnalyzeDocumentRequest(text, model_id)` | `stream AnalyzeDocumentEvent` | Server-streaming: `started` → `progress*` → `final`. |

### Status Codes

| Code | When |
|---|---|
| `OK` | Valid `PredictResponse` (unary) or `final` event (stream). |
| `INVALID_ARGUMENT` | Unsupported `model_id`, empty chunks, bad offsets, `text` exceeds `MAX_TEXT_CHARS`/`MAX_GLOBAL_TOKENS`. |
| `RESOURCE_EXHAUSTED` | Batch queue full (`1024`), worker unavailable, circuit open — shed load, health stays `SERVING`. |
| `UNAUTHENTICATED` | Missing/invalid/expired `Bearer` or bad `x-api-key` (`interceptors.py:36`). |
| `CANCELLED` | Client `context.done()` / disconnect. |
| `INTERNAL` | Unexpected engine / aggregation error. |

**Validation notes**

* `model_id` truncated to `64` at `servicers.py:18`, then `lower().strip()`, defaults to `spark`.
* Log values truncated to `500` chars (`_MAX_TEXT_LOG_LEN=500`) to prevent injection; tokens limited to `8192` (`_MAX_TOKEN_LEN=8192`) to guard DoS.
* `text` validated via `InputValidator` (`MAX_TEXT_CHARS=50000`); `CHUNK_TOKEN_LIMIT=256`/`STRIDE=192` sliding window.

## Observability

* **Logs:** JSON to stdout via `structlog` (`log_setup.py:13`), `trace_id`/`user_id`/`auth_type` bound via `contextvars`; `LOG_LEVEL` env controls level.
* **Tracing:** `opentelemetry` OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (`/v1/traces`), `GrpcAioInstrumentorServer` auto-instruments if available; fail-open if no endpoint (`tracing.py:17`).
* **Metrics:** `prometheus_client` at `:8333` (`start_http_server` in `main.py:34`). Key series:

| Metric | Type | Labels |
|---|---|---|
| `grpc_requests_total` | Counter | `method, code, model` |
| `grpc_auth_failures_total` | Counter | `method, reason` |
| `grpc_latency_seconds` | Histogram `0.005..10s` | `method, model` |
| `model_batch_size` | Histogram `1..512` | `model` |
| `model_batch_queue_size` | Gauge | `model` |
| `model_batch_queue_wait_seconds` | Histogram | `model` |
| `model_batch_processing_seconds` | Histogram | `model` |
| `model_ai_confidence_score` | Histogram `0.1..1.0` | `model` |
| `inference_service_health_status` | Gauge `serving/not_serving` | `status` |
| `inference_service_health_reason` | Gauge | `reason` |
| `inference_engine_health_status` | Gauge | `model, status` |
| `inference_engine_queue_capacity` | Gauge | `model` |
| `inference_engine_circuit_open_seconds` | Gauge | `model` |
| `inference_document_input_chars` | Histogram `128..65536` | `operation, model` |
| `inference_document_chunk_count` | Histogram `1..512` | `operation, model` |
| `inference_document_inflight_chunks` | Gauge | `operation, model` |
| `inference_document_requests_total` | Counter | `operation, model, status` |
| `inference_document_chunks_processed_total` | Counter | `operation, model` |
| `inference_document_chunks_failed_total` | Counter | `operation, model, reason` |
| `inference_batch_queue_rejected_total` | Counter | `model, reason` |
| `inference_batch_errors_total` | Counter | `model, error_type` |
| `inference_engine_provider_fallback_total` | Counter | `model, requested, active, trigger` |

Alerts (derived, mirror parser/gateway style):

* Inference down — `up{job=inference}==0` for `2m`
* High error rate — `rate(grpc_requests_total{code!="OK"}[5m]) >0.05`
* High latency — `histogram_quantile(0.95, grpc_latency_seconds) >2s` for `10m`
* Queue full / worker unavailable — `inference_engine_health_status{status="queue_full"}==1`
* Batch timeouts — `rate(inference_batch_errors_total{error_type="timeout"}[5m]) >0.1`

## Testing

```bash
make proto               # grpc_tools.protoc + sed fix + __init__.py
make test                # pytest tests/unit -v --cov=src --cov-report=term-missing
make test-coverage       # pytest --cov=src --cov-report=term-missing --cov-report=html --cov-report=xml tests/unit
make test-integration    # pytest tests/integration -v (needs HF cache or offline)
make lint                # ruff check .
```

Coverage omits `src/main.py` and `src/generated/*` (`pyproject.toml:53`). Tests use `API_KEY=ci-dummy-key-16chars-long`, `asyncio_mode=auto`.

## Docker

```bash
# Standalone (CPU by default, GPU via GPU=1)
make inference-build                 # docker build -t ai-service:latest .
make inference-up                    # compose.yml + Dockerfile.local (CPUExecutionProvider)
make inference-up GPU=1              # compose.gpu.yml -> Dockerfile + CUDAExecutionProvider (nvidia, 16G/8CPU)
make inference-logs                  # logs -f ai-service
make inference-ps                    # ps
make inference-down                  # down --remove-orphans
make inference-down-v                # down -v
# Prod variant (restart: always)
make inference-up-prod GPU=1

# Direct compose
docker build -t ai-service:latest .
docker build -f Dockerfile.local -t ai-service:local .
docker compose -f infra/compose.yml up --build -d
docker compose -f infra/compose.yml -f infra/compose.gpu.yml up --build -d
docker compose -f infra/compose.yml -f infra/compose.prod.yml up --build -d
grpc_health_probe -addr=:50051   # or curl -f grpc_health_probe
curl http://localhost:8333/metrics
```

* `infra/compose.yml:9` healthcheck `grpc_health_probe -addr=:50051` interval `30s` `start_period 10m` `start_interval 5s`; ports `50051:50051 8333:8333`; network `detectai_net`.
* `infra/compose.gpu.yml:2` overrides to `Dockerfile` + `CUDAExecutionProvider` with `deploy.resources.limits memory 16G cpus 8` and `nvidia` device.
* Env via `infra/.env.example` (also `AI_SERVICE_API_KEY` required). Root `infra/docker/prod/compose.yml:16` includes `services/inference/infra/compose.yml` for full stack.

## Proto Generation

```bash
make proto                     # poetry run python -m grpc_tools.protoc -I./protos ...
docker build ...               # also generates inside image (no host make needed)
```

Generated files in `src/generated/` (`ai_service_pb2.py`, `ai_service_pb2_grpc.py` with `from . import ai_service_pb2`) are committed for convenience but regenerated in CI (`service-inference.yaml:48`) and by `make test` (which depends on `proto`).

See [Load Testing](load/README.md) for `ramping-arrival-rate` vs `constant-vus` scenarios and `VUS/RPS/STAGES` tuning.

