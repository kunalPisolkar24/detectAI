# Internals

## Strategies

```mermaid
graph TB
    Factory[ExtractorFactory] --> Pdf[PdfExtractionStrategy PyMuPDF]
    Factory --> Docx[DocxExtractionStrategy python-docx]
    Factory --> Txt[TxtExtractionStrategy]
    Pdf --> Cleaner[TextCleaner normalize whitespace]
    Docx --> Cleaner
    Txt --> Cleaner
    Cleaner --> Resp[ExtractionResponse text + truncated flag]
```

* `PdfExtractionStrategy` — `fitz.open(path)`, guard `page_count > MAX_PDF_PAGES (1000)` → `422`, iterate pages with `get_text("blocks")` filtered by `HEADER_FOOTER_MARGIN_PT` band and `TEXT_BLOCK_TYPE`, track `unreadable_pages` for `truncated` (no dead `total_pages`), join via `_drop_repeated_lines` with `HEADER_REPETITION_RATIO 0.8`, break when `total_length > MAX_TEXT_LENGTH (1M)`.
* `DocxExtractionStrategy` — `_guard_uncompressed_size` via `zipfile.infolist()` sum vs `MAX_DOCX_UNCOMPRESSED_BYTES (100 MB)` → `422`, then `docx.Document(path)` paragraph join with `_clean_inline` stripping field control chars `[\x13\x14\x15]`.
* `TxtExtractionStrategy` — `read()` then `decode("utf-8").removeprefix(UTF8_BOM)` fallback to `latin-1` with `LATIN1_BOM`.
* `TextCleaner` — normalize `\r\n`, strip control/invisible chars, fix hyphenated line breaks, dedupe spaces, collapse `\n{3,}` → `\n\n`.

## ThreadPool

```mermaid
graph TB
    Request[POST /extract] --> Queue[ThreadPoolExecutor max WORKER_THREADS]
    Queue --> Worker[run_extraction_task]
    Worker --> Temp[Write tmp file with NamedTemporaryFile]
    Temp --> Strat[Strategy extract]
    Strat --> Clean[TextCleaner clean]
    Clean --> Del[Unlink tmp]
    Del --> Res[Return ExtractionResult]
    Queue --> Metrics[Gauges via _pool_snapshot busy/queued/max]
```

* Pool size `WORKER_THREADS` env or `os.cpu_count()`, `READINESS_MAX_QUEUE_DEPTH=50`.
* Centralised `_pool_snapshot()` in `app/core/metrics.py:109` hides `ThreadPoolExecutor._work_queue.qsize()` / `_max_workers` / `_shutdown`; `get_pool_stats()` and `refresh_process_pool_gauges()` delegate to it, `is_process_pool_healthy()` checks `not _shutdown` via `getattr`.
* `run_extraction_task` (`app/domain/extraction/service.py:26`) records `extraction_queue_wait_seconds`, `mark_extraction_started/finished`, measures `extraction_duration_seconds` with success/error labels, then `TextCleaner.clean`.
* `ExtractionService.process_file` uses `content = b""` init before `try` (replaces fragile `"content" in dir()`), defense-in-depth size check vs `MAX_UPLOAD_SIZE_BYTES` even though `validate_upload` already fail-fasts, writes tmp, unlinks in `finally`.
* Timeout `EXTRACTION_TIMEOUT_SECONDS=30.0` via `asyncio.wait_for(run_in_executor(...), timeout=30)` in `app/api/v1/endpoints/extract.py:28`.
* Unified error taxonomy via `_REJECTED_REASON_MAP` and `_ERROR_TYPE_MAP` in `app/core/metrics.py:192-204` (`too_large` vs `file_too_large/document_too_large` split).

## Class view

```mermaid
classDiagram
    class ExtractorFactory {
        +get_strategy(mime): ExtractionStrategy
    }
    class ExtractionStrategy {
        <<interface>>
        +extract(path): ExtractionResult
    }
    class ExtractionService {
        +process_file(file, mime): ExtractionResult
        +run_extraction_task(file, mime, submitted_at)
    }
    class PoolHelpers {
        +_pool_snapshot(): busy, queued, max
        +get_pool_stats()
        +is_process_pool_healthy(): bool
        +refresh_process_pool_gauges()
    }
    class ExceptionMaps {
        +_REJECTED_REASON_MAP
        +_ERROR_TYPE_MAP
        +classify_extraction_error()
    }
    ExtractorFactory --> ExtractionStrategy
    ExtractionService --> ExtractorFactory
    ExtractionService --> PoolHelpers
    ExtractionService --> ExceptionMaps
```

Temp file isolation prevents zip bomb — `MAX_DOCX_UNCOMPRESSED_BYTES` checked before parsing. `app/main.py:28` registers `document_parser_exception_handler` directly; single `_combined_middleware` handles logging + metrics timing.

See `01-architecture.md` for readiness graph and `08-configuration.md` for env.
