# Architecture

## High-level

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

Single gRPC port `50051`, metrics `8333`. Two isolated models prevent starvation. `QUEUE_FULL` sheds as `RESOURCE_EXHAUSTED`, not `NOT_SERVING`.

## Hexagonal ports

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

Ports live in `src/application/ports/outbound/`; adapters in `src/adapters/`; domain in `src/domain/`.

## Startup DAG

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

Per-model `ThreadPoolExecutor` sized in `src/main.py:41`:

```python
spark_workers = max(4, workers // 2)
flare_workers = max(4, workers - spark_workers)
```

`HuggingFaceLoader` runs in executor during startup (`run_in_executor`), then `BatchingProxy.start()` spawns `worker_loop`.

## Class view

```mermaid
classDiagram
    class DocumentAnalysisService {
        -engines: dict[str, IAsyncInferenceEngine]
        -planners: dict[str, ChunkPlanner]
        -validator: InputValidator
        -aggregator: ResultAggregator
        +analyze(text, model_key): DocumentScore
        +stream(text, model_key): AsyncGenerator
        +health_snapshot(): BatcherHealthSnapshot
    }
    class BatchingProxy {
        -queue: asyncio.Queue
        -engine: ISyncBatchInferenceEngine
        -executor: ThreadPoolExecutor
        +predict(text): float
        +health_snapshot(): BatcherHealthSnapshot
        -worker_loop()
        -process_batch()
    }
    class ChunkPlanner {
        -chunker: TokenChunker
        -chunk_size: int
        -stride: int
        +plan(text): List[DocumentChunk]
    }
    class ResultAggregator {
        -chunk_stride: int
        +aggregate(chunks, probs): DocumentScore
        -build_highlight_spans(): List[HighlightSpan]
    }
    class SparkEngine {
        +predict_batch(texts): List[float]
    }
    class FlareEngine {
        +predict_batch(texts): List[float]
    }
    class HuggingFaceLoader {
        +load(model_key): tuple[session, tokenizer]
        -verify_providers()
    }
    DocumentAnalysisService --> BatchingProxy
    DocumentAnalysisService --> ChunkPlanner
    DocumentAnalysisService --> ResultAggregator
    BatchingProxy --> SparkEngine
    BatchingProxy --> FlareEngine
    BatchingProxy --> HuggingFaceLoader
    ChunkPlanner --> BertTokenChunker
    ChunkPlanner --> RegexTokenChunker
```

* `BatchingProxy` implements both `IAsyncInferenceEngine` (for `DocumentAnalysisService`) and `IEngineHealthReporter` (for `HealthMonitor`).
* See `02-request-flows.md` for how `analyze`/`stream` use these classes, and `05-batching.md` for queue details.
