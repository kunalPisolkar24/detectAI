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

* `PdfExtractionStrategy` — `pymupdf` open doc, iterate pages up to `1000`, `get_text()`, check `char cap 1M`.
* `DocxExtractionStrategy` — `python-docx` `Document(path)`, unzip guard `100 MB` before parse, `paragraph.text` join.
* `TxtExtractionStrategy` — `read().decode('utf-8', errors='ignore')`.
* `TextCleaner` — `re.sub(r'\s+', ' ', text).strip()` + `truncate 1M`.

## ThreadPool

```mermaid
graph TB
    Request[POST /extract] --> Queue[ThreadPoolExecutor max 4]
    Queue --> Worker[run_extraction_task]
    Worker --> Temp[Write tmp file]
    Temp --> Strat[Strategy extract]
    Strat --> Clean[Clean]
    Clean --> Del[Unlink tmp]
    Del --> Res[Return]
    Queue --> Metrics[Prometheus gauges busy/queued/max]
```

* Pool size `WORKER_THREADS` env or `os.cpu_count()`, `READINESS_MAX_QUEUE_DEPTH=50`.
* `is_ready()` → `busy < max and queued <50`.
* Timeout `30s` via `concurrent.futures.wait(..., timeout=30)`.

## Class view

```mermaid
classDiagram
    class ExtractorFactory {
        +get_extractor(mime): IExtractor
    }
    class IExtractor {
        <<interface>>
        +extract(path): str
    }
    class ThreadPoolManager {
        -executor: ThreadPoolExecutor
        -max_queue: int
        +submit(task): Future
        +is_ready(): bool
    }
    class Validator {
        +validate_size()
        +sniff_mime()
    }
    ExtractorFactory --> IExtractor
    ThreadPoolManager --> IExtractor
    Validator --> ExtractorFactory
```

Temp file isolation prevents `zip bomb` — `MAX_DOCX_UNCOMPRESSED_BYTES` checked via `zipfile.infolist()` sum before extraction.

See `01-architecture.md` for readiness graph and `08-configuration.md` for env.
