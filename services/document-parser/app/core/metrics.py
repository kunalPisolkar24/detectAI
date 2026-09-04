import os
import threading
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    REGISTRY,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    multiprocess,
)
from app.core.exceptions import (
    DocumentTooLargeError,
    ExtractionError,
    ExtractionTimeoutError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total number of HTTP requests",
    ["method", "route", "status_code"],
)

HTTP_REQUEST_ERRORS_TOTAL = Counter(
    "http_request_errors_total",
    "Total number of HTTP requests resulting in errors",
    ["method", "route", "status_code"],
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "http_request_duration_seconds",
    "Duration of HTTP requests in seconds",
    ["method", "route", "status_code"],
    buckets=(0.01, 0.05, 0.1, 0.3, 0.5, 1.0, 2.5, 5.0, 10.0),
)

PARSED_FILE_SIZE_BYTES = Histogram(
    "parsed_file_size_bytes",
    "Distribution of uploaded file sizes in bytes",
    ["mime_type"],
    buckets=(1024, 10240, 102400, 524288, 1048576, 5242880, 10485760),
)

PARSED_DOCUMENTS_TOTAL = Counter(
    "parsed_documents_total",
    "Total number of documents processed",
    ["mime_type", "status"],
)

EXTRACTED_TEXT_BYTES_TOTAL = Counter(
    "extracted_text_bytes_total",
    "Total volume of text extracted in bytes",
    ["mime_type"],
)

EXTRACTION_FAILURES_TOTAL = Counter(
    "extraction_failures_total",
    "Total number of extraction failures by error type",
    ["mime_type", "error_type"],
)

EXTRACTION_TIMEOUTS_TOTAL = Counter(
    "extraction_timeouts_total",
    "Total number of extractions aborted after the timeout",
    ["mime_type"],
)

REJECTED_UPLOADS_TOTAL = Counter(
    "rejected_uploads_total",
    "Total number of uploads rejected before extraction",
    ["reason"],
)

IN_FLIGHT_REQUESTS = Gauge(
    "in_flight_requests",
    "Number of HTTP requests currently being processed",
)

EXTRACTION_QUEUE_WAIT_SECONDS = Histogram(
    "extraction_queue_wait_seconds",
    "Time between executor submission and extraction start",
    ["mime_type"],
    buckets=(0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0),
)

EXTRACTION_POOL_ACTIVE_THREADS = Gauge(
    "extraction_pool_active_threads",
    "Worker threads currently active in the extraction pool",
)

EXTRACTION_POOL_QUEUE_DEPTH = Gauge(
    "extraction_pool_queue_depth",
    "Tasks waiting in the extraction pool queue",
)

EXTRACTION_POOL_MAX_WORKERS = Gauge(
    "extraction_pool_max_workers",
    "Configured worker threads in the extraction pool",
)

_process_pool = None
_pool_state_lock = threading.Lock()
_pool_busy_tasks = 0


def _pool_snapshot() -> tuple[int, int, int] | None:
    """Centralised snapshot of pool state; hides private ThreadPoolExecutor attrs."""
    if _process_pool is None:
        return None
    with _pool_state_lock:
        busy = _pool_busy_tasks
    try:
        queued = _process_pool._work_queue.qsize()  # type: ignore[attr-defined]
    except Exception:
        queued = 0
    max_workers = getattr(_process_pool, "_max_workers", 0)
    return busy, queued, max_workers


def register_process_pool(pool) -> None:
    global _process_pool
    _process_pool = pool
    refresh_process_pool_gauges()


def mark_extraction_started() -> None:
    global _pool_busy_tasks
    with _pool_state_lock:
        _pool_busy_tasks += 1


def mark_extraction_finished() -> None:
    global _pool_busy_tasks
    with _pool_state_lock:
        _pool_busy_tasks -= 1


def get_pool_stats() -> tuple[int, int, int] | None:
    return _pool_snapshot()


def refresh_process_pool_gauges() -> None:
    stats = _pool_snapshot()
    if stats is None:
        return
    busy, queued, max_workers = stats
    EXTRACTION_POOL_ACTIVE_THREADS.set(busy)
    EXTRACTION_POOL_QUEUE_DEPTH.set(queued)
    EXTRACTION_POOL_MAX_WORKERS.set(max_workers)


def is_process_pool_healthy() -> bool:
    return _process_pool is not None and not getattr(_process_pool, "_shutdown", False)

EXTRACTION_DURATION_SECONDS = Histogram(
    "extraction_duration_seconds",
    "Time spent parsing documents",
    ["mime_type", "status"],
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0),
)

EXTRACTED_TEXT_LENGTH_BYTES = Histogram(
    "extracted_text_length_bytes",
    "Distribution of cleaned extracted text size in bytes",
    ["mime_type"],
    buckets=(1024, 10240, 102400, 262144, 524288, 1048576, 2097152, 5242880),
)

EXTRACTION_COMPRESSION_RATIO = Histogram(
    "extraction_compression_ratio",
    "Ratio of input file bytes to extracted text bytes",
    ["mime_type"],
    buckets=(0.5, 1, 2, 5, 10, 25, 50, 100, 500),
)


def record_extraction_duration(mime_type: str, status: str, duration_seconds: float) -> None:
    EXTRACTION_DURATION_SECONDS.labels(mime_type=mime_type, status=status).observe(duration_seconds)


def record_extraction_queue_wait(mime_type: str, wait_seconds: float) -> None:
    EXTRACTION_QUEUE_WAIT_SECONDS.labels(mime_type=mime_type).observe(wait_seconds)


def record_extraction_timeout(mime_type: str) -> None:
    EXTRACTION_TIMEOUTS_TOTAL.labels(mime_type=mime_type).inc()


_REJECTED_REASON_MAP: dict[type[Exception], str] = {
    FileTooLargeError: "too_large",
    DocumentTooLargeError: "too_large",
    UnsupportedFileTypeError: "unsupported_type",
}

_ERROR_TYPE_MAP: dict[type[Exception], str] = {
    FileTooLargeError: "file_too_large",
    DocumentTooLargeError: "document_too_large",
    UnsupportedFileTypeError: "unsupported_file_type",
    ExtractionTimeoutError: "timeout",
    ExtractionError: "corrupt_document",
}


def record_rejected_upload(exc: Exception) -> None:
    for exc_type, reason in _REJECTED_REASON_MAP.items():
        if isinstance(exc, exc_type):
            REJECTED_UPLOADS_TOTAL.labels(reason=reason).inc()
            return


def classify_extraction_error(exc: Exception) -> str:
    for exc_type, label in _ERROR_TYPE_MAP.items():
        if isinstance(exc, exc_type):
            return label
    return "unexpected"


def record_request(method: str, route: str, status_code: int, duration: float) -> None:
    status_code_label = str(status_code)
    HTTP_REQUESTS_TOTAL.labels(method=method, route=route, status_code=status_code_label).inc()
    HTTP_REQUEST_DURATION_SECONDS.labels(method=method, route=route, status_code=status_code_label).observe(duration)
    if status_code >= 400:
        HTTP_REQUEST_ERRORS_TOTAL.labels(method=method, route=route, status_code=status_code_label).inc()


def record_extraction(mime_type: str, file_size_bytes: int, text_bytes: int) -> None:
    PARSED_FILE_SIZE_BYTES.labels(mime_type=mime_type).observe(file_size_bytes)
    PARSED_DOCUMENTS_TOTAL.labels(mime_type=mime_type, status="success").inc()
    EXTRACTED_TEXT_BYTES_TOTAL.labels(mime_type=mime_type).inc(text_bytes)
    EXTRACTED_TEXT_LENGTH_BYTES.labels(mime_type=mime_type).observe(text_bytes)
    if file_size_bytes > 0 and text_bytes > 0:
        EXTRACTION_COMPRESSION_RATIO.labels(mime_type=mime_type).observe(file_size_bytes / text_bytes)


def record_extraction_failure(mime_type: str, file_size_bytes: int, error_type: str = "unexpected") -> None:
    PARSED_FILE_SIZE_BYTES.labels(mime_type=mime_type).observe(file_size_bytes)
    PARSED_DOCUMENTS_TOTAL.labels(mime_type=mime_type, status="error").inc()
    EXTRACTION_FAILURES_TOTAL.labels(mime_type=mime_type, error_type=error_type).inc()


def render_metrics() -> tuple[bytes, str]:
    registry = REGISTRY
    if os.getenv("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
    return generate_latest(registry), CONTENT_TYPE_LATEST
