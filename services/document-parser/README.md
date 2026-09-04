# Document Parser

Stateless Python service that extracts clean text from PDF, DOCX and TXT via ThreadPool and returns normalized output. No DB — MIME-sniff validation with temp-file isolation and timeout.

## Overview

Stateless service handling `POST /extract` (multipart `file` + `python-magic` sniff) with `10 MiB` limit, `30s` timeout, `1M` char cap and `1000` page / `100 MB` uncompressed guards, via `ThreadPoolExecutor` with pool-aware readiness.

## Packages

| Package | Purpose |
|---|---|
| `fastapi`, `uvicorn`, `gunicorn` | HTTP server |
| `pymupdf` | PDF extraction |
| `python-docx`, `python-magic` | DOCX / MIME sniff |
| `pydantic-settings` | Config |
| `prometheus-client` | Metrics |
| `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-exporter-otlp-proto-http`, `opentelemetry-instrumentation-fastapi` | Tracing |
| `python-multipart` | Multipart |
| `httpx`, `pytest`, `pytest-cov`, `pytest-mock` | Tests |
| `ruff` | Lint |

See `pyproject.toml` for full list.

## Architecture

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

```mermaid
graph TB
    PoolState["Pool busy/queued/max"] --> Check{"busy < max and queued < 50?"}
    Check -->|yes| Ready["200 ready"]
    Check -->|no| NotReady["503 not_ready"]
    Ready --> EP["/extract"]
    NotReady --> Block["reject /ready"]
```

- `PdfExtractionStrategy` vs `DocxExtractionStrategy` vs `TxtExtractionStrategy` via `ExtractorFactory` with `TextCleaner`.
- Pool-aware readiness via `READINESS_MAX_QUEUE_DEPTH=50` and `WORKER_THREADS` (busy >= max or queued >= 50 → 503).

## Document Validation

```mermaid
sequenceDiagram
    participant Client
    participant DP as Parser
    participant V as Validator
    participant S as Strategy
    Client->>DP: POST /extract with file
    DP->>V: Read 4096 bytes + magic sniff
    V->>V: Check size <= 10 MiB
    V->>V: Check mime in ALLOWED
    alt valid
        DP->>S: Write tmp file + extract
        S-->>DP: Raw text + truncated
        DP-->>Client: 200 ExtractionResponse
    else invalid
        DP-->>Client: 413/415
    end
```

## Configuration

```ini
MAX_UPLOAD_SIZE_BYTES=10485760        # optional, 10 MiB
MAX_TEXT_LENGTH=1000000               # optional, 1M chars
MAX_PDF_PAGES=1000                    # optional
MAX_DOCX_UNCOMPRESSED_BYTES=104857600 # optional, 100 MB
EXTRACTION_TIMEOUT_SECONDS=30.0       # optional
READINESS_MAX_QUEUE_DEPTH=50          # optional
WORKER_THREADS=4                      # optional, cpu_count fallback
PORT=8000                             # optional
OTEL_EXPORTER_OTLP_ENDPOINT=          # optional, disables tracing
```

## API

```text
GET  /health          -> 200 {"status":"ok"} | 503 {"status":"unavailable"}
GET  /ready           -> 200 {"status":"ready"} | 503 {"status":"not_ready"}
GET  /metrics         -> Prometheus
POST /extract         (multipart file) -> 200 ExtractionResponse | 413 415 422 504
```

## Observability

Logs are JSON to stdout. Tracing is OTel if an OTLP endpoint is set. Metrics at GET /metrics for Prometheus.

Metrics configured:

- HTTP requests total — counts every request by method, route and status code
- HTTP request duration — measures how long each request takes
- Parsed documents total — counts extractions by mime type and status
- Extraction failures — counts failures by mime type and error type
- Rejected uploads — counts rejections by reason (too_large, unsupported_type)
- Extraction pool — gauges active threads, queue depth and max workers

Alerts configured:

- Parser down — parser not up for more than 2 minutes
- High error rate — error rate above 5% for 10 minutes
- High latency — p95 request latency above 2 seconds for 10 minutes
- Extraction failures — more than 0.1 failures per second for 10 minutes
- High rejection rate — more than 1 rejection per second for 15 minutes
- Pool saturation — pool saturated and queue depth >10 for 10 minutes

## Testing

```bash
make test              # poetry run pytest -v
make test-coverage     # poetry run pytest --cov=app --cov-report=term-missing --cov-report=html --cov-report=xml
make test-integration  # poetry run pytest -m integration -v
make load-test VUS=5 DURATION=10s  # k6 ramping-vus / ramping-arrival-rate via infra/compose.load.yml
```

See [Load Testing](load/README.md) for scenarios and env.

## Docker

```bash
make parser-build                     # docker build -t detectai-document-parser .
make parser-up                        # docker compose -f infra/compose.yml up --build -d
make parser-down                      # down --remove-orphans
make parser-down-v                    # down -v
make parser-logs                      # logs -f document-parser
make parser-ps                        # ps
```
