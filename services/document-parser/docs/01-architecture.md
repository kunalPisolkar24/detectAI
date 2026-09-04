# Architecture

## High-level

```mermaid
graph LR
    Client --> DP[Document Parser]
    DP --> Pool[(ThreadPool)]
    Pool --> PDF[PyMuPDF]
    Pool --> DOCX[python-docx]
    Pool --> TXT[TXT]
    PDF --> Cleaner[TextCleaner]
    DOCX --> Cleaner
    TXT --> Cleaner
    Cleaner --> Resp[ExtractionResponse]
```

Stateless `FastAPI` + `ThreadPoolExecutor` (default `WORKER_THREADS=4`, fallback `cpu_count`). No DB. `app/main.py:28` registers `document_parser_exception_handler` directly (no wrapper) and single `_combined_middleware` centralises JSON logging + `in_flight_requests` + `record_request` with one `perf_counter()`.

## Sequence

```mermaid
sequenceDiagram
    participant Client
    participant CM as CombinedMiddleware
    participant V as Validator
    participant Pool as ThreadPool
    Client->>CM: POST /extract multipart
    CM->>V: validate_upload size + magic sniff
    alt invalid
        CM-->>Client: 413/415
    else valid
        CM->>Pool: run_extraction_task via run_in_executor
        Pool-->>CM: ExtractionResult
        CM->>CM: log duration_ms+trace_id + record_request
        CM-->>Client: 200 cleaned text
    end
```

Timeout via `asyncio.wait_for(..., EXTRACTION_TIMEOUT_SECONDS=30)` in `app/api/v1/endpoints/extract.py`.

## Readiness

```mermaid
graph TB
    PoolState["_pool_snapshot busy/queued/max"] --> Health{"is_process_pool_healthy?<br/>not None and not _shutdown"}
    Health -->|no| Unavail["503 health not_healthy<br/>/health unavailable"]
    Health -->|yes| Check{"busy < max and queued < 50?"}
    Check -->|yes| Ready["200 ready"]
    Check -->|no| NotReady["503 not_ready"]
    Ready --> EP["/extract"]
    NotReady --> Block["reject /ready"]
```

Pool-aware via `app/core/metrics.py:_pool_snapshot` (hides `_work_queue.qsize()`, `_max_workers`, `_shutdown`). `GET /health` checks `is_process_pool_healthy()` only; `GET /ready` checks healthy + `busy >= max` or `queued >= READINESS_MAX_QUEUE_DEPTH (50)` plus race guard `stats is None`. See `app/api/v1/endpoints/health.py`.

## Class view

```mermaid
classDiagram
    class FastAPIApp {
        +lifespan: ThreadPoolExecutor
        +_combined_middleware()
        +post_extract()
        +get_health()
        +get_ready()
    }
    class ExtractorFactory {
        +get_strategy(mime): ExtractionStrategy
    }
    class ExtractionStrategy {
        <<interface>>
        +extract(path): ExtractionResult
    }
    class PdfExtractionStrategy {
        -unreadable_pages: int
        +extract(): truncated bool
    }
    class TextCleaner {
        +clean(text): str
    }
    class PoolHelpers {
        +_pool_snapshot(): busy, queued, max
        +get_pool_stats()
        +is_process_pool_healthy()
    }
    FastAPIApp --> ExtractorFactory
    ExtractorFactory --> ExtractionStrategy
    ExtractionStrategy <|-- PdfExtractionStrategy
    PdfExtractionStrategy --> TextCleaner
    FastAPIApp --> PoolHelpers
```

`app/main.py` wires `ExtractorFactory` + `TextCleaner` + `PoolHelpers`; `python-magic` sniff in `app/api/deps.py` picks strategy. Dead `total_pages` counter removed; error taxonomy unified via `_REJECTED_REASON_MAP`/`_ERROR_TYPE_MAP`.

See `02-validation.md` for sniff and `03-internals.md` for pool details.
