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

Stateless `FastAPI` + `ThreadPoolExecutor` (default `WORKER_THREADS=4`, fallback `cpu_count`). No DB.

## Sequence

```mermaid
sequenceDiagram
    participant Client
    participant DP as Parser
    participant V as Validator
    participant Pool as ThreadPool
    Client->>DP: POST /extract multipart
    DP->>V: Validate size + magic sniff
    alt invalid
        DP-->>Client: 413/415
    else valid
        DP->>Pool: run_extraction_task
        Pool-->>DP: ExtractionResult
        DP-->>Client: 200 cleaned text
    end
```

## Readiness

```mermaid
graph TB
    PoolState["Pool busy/queued/max"] --> Check{"busy < max and queued < 50?"}
    Check -->|yes| Ready["200 ready"]
    Check -->|no| NotReady["503 not_ready"]
    Ready --> EP["/extract"]
    NotReady --> Block["reject /ready"]
```

Pool-aware: `busy >= max` or `queued >= 50` → `503` at `GET /ready`; `GET /health` checks pool not saturated.

## Class view

```mermaid
classDiagram
    class FastAPIApp {
        +post_extract()
        +get_health()
        +get_ready()
    }
    class ExtractorFactory {
        +get_extractor(mime): IExtractor
    }
    class IExtractor {
        <<interface>>
        +extract(path): str
    }
    class PdfExtractor {
        +extract(): str
    }
    class DocxExtractor {
        +extract(): str
    }
    class TxtExtractor {
        +extract(): str
    }
    class TextCleaner {
        +clean(text): str
    }
    class ThreadPoolManager {
        -executor: ThreadPoolExecutor
        +run_extraction_task()
        +is_ready(): bool
    }
    FastAPIApp --> ExtractorFactory
    ExtractorFactory --> IExtractor
    IExtractor <|-- PdfExtractor
    IExtractor <|-- DocxExtractor
    IExtractor <|-- TxtExtractor
    PdfExtractor --> TextCleaner
    DocxExtractor --> TextCleaner
    TxtExtractor --> TextCleaner
    FastAPIApp --> ThreadPoolManager
```

`app/main.py` wires `ExtractorFactory` + `TextCleaner` + `ThreadPoolManager`; `python-magic` sniff picks strategy.

See `02-validation.md` for sniff and `03-internals.md` for pool details.
