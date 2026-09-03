from grpc_health.v1 import health_pb2
from prometheus_client import REGISTRY, Counter, Gauge, Histogram

from src.domain.models import BatcherHealthSnapshot, BatcherHealthStatus
from src.application.ports.outbound.telemetry import ITelemetryReporter


def _safe_counter(name: str, doc: str, labels: list[str], **kwargs):  # type: ignore[no-untyped-def]
    try:
        return Counter(name, doc, labels, **kwargs)
    except ValueError:
        # Already registered (e.g., tests importing via src.* and inference.* paths)
        existing = REGISTRY._names_to_collectors.get(name)  # type: ignore[attr-defined]
        if existing is not None:
            return existing
        # Fallback: try with _total suffix variant
        existing = REGISTRY._names_to_collectors.get(f"{name}_total")  # type: ignore[attr-defined]
        if existing is not None:
            return existing
        raise


def _safe_gauge(name: str, doc: str, labels: list[str], **kwargs):  # type: ignore[no-untyped-def]
    try:
        return Gauge(name, doc, labels, **kwargs)
    except ValueError:
        existing = REGISTRY._names_to_collectors.get(name)  # type: ignore[attr-defined]
        if existing is not None:
            return existing
        raise


def _safe_histogram(name: str, doc: str, labels: list[str], **kwargs):  # type: ignore[no-untyped-def]
    try:
        return Histogram(name, doc, labels, **kwargs)
    except ValueError:
        existing = REGISTRY._names_to_collectors.get(name)  # type: ignore[attr-defined]
        if existing is not None:
            return existing
        raise


GRPC_REQUESTS_TOTAL = _safe_counter(
    'grpc_requests_total',
    'Total number of gRPC requests',
    ['method', 'code', 'model'],
)

GRPC_AUTH_FAILURES_TOTAL = _safe_counter(
    'grpc_auth_failures_total',
    'Total number of rejected gRPC requests during authentication',
    ['method', 'reason'],
)

GRPC_LATENCY_SECONDS = _safe_histogram(
    'grpc_latency_seconds',
    'Request latency in seconds',
    ['method', 'model'],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0],
)

BATCH_SIZE_DISTRIBUTION = _safe_histogram(
    'model_batch_size',
    'Distribution of batch sizes processed',
    ['model'],
    buckets=[1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
)

BATCH_QUEUE_SIZE = _safe_gauge(
    'model_batch_queue_size',
    'Current number of items waiting in the batch queue',
    ['model'],
)

BATCH_PROCESSING_TIME = _safe_histogram(
    'model_batch_processing_seconds',
    'Time taken to process the actual batch on hardware',
    ['model'],
)

AI_CONFIDENCE_SCORE = _safe_histogram(
    'model_ai_confidence_score',
    'Distribution of AI probability scores',
    ['model'],
    buckets=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
)

INFERENCE_SERVICE_HEALTH_STATUS = _safe_gauge(
    'inference_service_health_status',
    'Current gRPC health state for the inference service',
    ['status'],
)

INFERENCE_SERVICE_HEALTH_REASON = _safe_gauge(
    'inference_service_health_reason',
    'Current gRPC health failure reason for the inference service',
    ['reason'],
)

INFERENCE_ENGINE_HEALTH_STATUS = _safe_gauge(
    'inference_engine_health_status',
    'Current health state for each inference engine',
    ['model', 'status'],
)

INFERENCE_ENGINE_QUEUE_CAPACITY = _safe_gauge(
    'inference_engine_queue_capacity',
    'Configured queue capacity for each inference engine',
    ['model'],
)

INFERENCE_ENGINE_CIRCUIT_OPEN_SECONDS = _safe_gauge(
    'inference_engine_circuit_open_seconds',
    'Remaining time that the inference circuit stays open',
    ['model'],
)

INFERENCE_DOCUMENT_INPUT_CHARS = _safe_histogram(
    'inference_document_input_chars',
    'Input document size in characters',
    ['operation', 'model'],
    buckets=[128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536],
)

INFERENCE_DOCUMENT_CHUNK_COUNT = _safe_histogram(
    'inference_document_chunk_count',
    'Number of planned chunks per inference request',
    ['operation', 'model'],
    buckets=[1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
)

INFERENCE_DOCUMENT_INFLIGHT_CHUNKS = _safe_gauge(
    'inference_document_inflight_chunks',
    'Current number of in-flight chunk predictions',
    ['operation', 'model'],
)

INFERENCE_DOCUMENT_CHUNKS_PROCESSED_TOTAL = _safe_counter(
    'inference_document_chunks_processed_total',
    'Total number of processed document chunks',
    ['operation', 'model'],
)

INFERENCE_DOCUMENT_CHUNKS_FAILED_TOTAL = _safe_counter(
    'inference_document_chunks_failed_total',
    'Total number of failed document chunks',
    ['operation', 'model', 'reason'],
)

INFERENCE_BATCH_QUEUE_REJECTED_TOTAL = _safe_counter(
    'inference_batch_queue_rejected_total',
    'Total number of rejected batch queue insertions',
    ['model', 'reason'],
)

INFERENCE_BATCH_ERRORS_TOTAL = _safe_counter(
    'inference_batch_errors_total',
    'Total number of batch processing errors',
    ['model', 'error_type'],
)

MODEL_BATCH_QUEUE_WAIT_SECONDS = _safe_histogram(
    'model_batch_queue_wait_seconds',
    'Time a batch item waited in the queue before processing',
    ['model'],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 5.0],
)

INFERENCE_ENGINE_PROVIDER_FALLBACK_TOTAL = _safe_counter(
    'inference_engine_provider_fallback_total',
    'Total number of provider fallbacks (GPU missing or offline)',
    ['model', 'requested', 'active', 'trigger'],
)

INFERENCE_DOCUMENT_REQUESTS_TOTAL = _safe_counter(
    'inference_document_requests_total',
    'Total number of document requests by outcome',
    ['operation', 'model', 'status'],
)

_SERVICE_HEALTH_STATUSES = ('serving', 'not_serving')
_SERVICE_HEALTH_REASONS = (
    'none',
    'service_initializing',
    'shutdown_in_progress',
    'batch_worker_stopped',
    'inference_circuit_open',
    'inference_queue_full',
    'unknown',
)


class PrometheusTelemetryReporter(ITelemetryReporter):
    def observe_document_plan(self, operation: str, model_name: str, input_chars: int, chunk_count: int) -> None:
        try:
            INFERENCE_DOCUMENT_INPUT_CHARS.labels(operation=operation, model=model_name).observe(input_chars)
            INFERENCE_DOCUMENT_CHUNK_COUNT.labels(operation=operation, model=model_name).observe(chunk_count)
        except Exception:
            pass

    def track_document_chunk_started(self, operation: str, model_name: str) -> None:
        try:
            INFERENCE_DOCUMENT_INFLIGHT_CHUNKS.labels(operation=operation, model=model_name).inc()
        except Exception:
            pass

    def track_document_chunk_finished(self, operation: str, model_name: str) -> None:
        try:
            INFERENCE_DOCUMENT_INFLIGHT_CHUNKS.labels(operation=operation, model=model_name).dec()
        except Exception:
            pass

    def record_document_chunk_processed(self, operation: str, model_name: str) -> None:
        try:
            INFERENCE_DOCUMENT_CHUNKS_PROCESSED_TOTAL.labels(operation=operation, model=model_name).inc()
        except Exception:
            pass

    def record_document_chunk_failed(self, operation: str, model_name: str, reason: str = "error") -> None:
        try:
            INFERENCE_DOCUMENT_CHUNKS_FAILED_TOTAL.labels(operation=operation, model=model_name, reason=reason).inc()
        except Exception:
            pass


def record_auth_failure(method_name: str, reason: str) -> None:
    GRPC_AUTH_FAILURES_TOTAL.labels(method=method_name, reason=reason).inc()


def set_service_health(state: int, reason: str | None) -> None:
    active_status = 'serving' if state == health_pb2.HealthCheckResponse.SERVING else 'not_serving'
    active_reason = reason or 'none'
    if active_reason not in _SERVICE_HEALTH_REASONS:
        active_reason = 'unknown'

    for status in _SERVICE_HEALTH_STATUSES:
        INFERENCE_SERVICE_HEALTH_STATUS.labels(status=status).set(1 if status == active_status else 0)

    for health_reason in _SERVICE_HEALTH_REASONS:
        INFERENCE_SERVICE_HEALTH_REASON.labels(reason=health_reason).set(1 if health_reason == active_reason else 0)


def set_queue_size(model_name: str, size: int) -> None:
    try:
        BATCH_QUEUE_SIZE.labels(model=model_name).set(max(0, int(size)))
    except Exception:
        pass


def set_engine_health(model_name: str, snapshot: BatcherHealthSnapshot) -> None:
    for status in BatcherHealthStatus:
        INFERENCE_ENGINE_HEALTH_STATUS.labels(model=model_name, status=status.value).set(
            1 if status == snapshot.status else 0
        )

    INFERENCE_ENGINE_QUEUE_CAPACITY.labels(model=model_name).set(snapshot.queue_capacity)
    INFERENCE_ENGINE_CIRCUIT_OPEN_SECONDS.labels(model=model_name).set(snapshot.circuit_open_remaining or 0)


def record_queue_rejected(model_name: str, reason: str) -> None:
    try:
        INFERENCE_BATCH_QUEUE_REJECTED_TOTAL.labels(model=model_name, reason=reason).inc()
    except Exception:
        pass


def record_batch_error(model_name: str, error_type: str) -> None:
    try:
        INFERENCE_BATCH_ERRORS_TOTAL.labels(model=model_name, error_type=error_type).inc()
    except Exception:
        pass


def observe_queue_wait(model_name: str, seconds: float) -> None:
    try:
        MODEL_BATCH_QUEUE_WAIT_SECONDS.labels(model=model_name).observe(max(0.0, float(seconds)))
    except Exception:
        pass


def record_provider_fallback(model_name: str, requested: str, active: str, trigger: str) -> None:
    try:
        INFERENCE_ENGINE_PROVIDER_FALLBACK_TOTAL.labels(
            model=model_name, requested=requested, active=active, trigger=trigger
        ).inc()
    except Exception:
        pass


def record_document_request(operation: str, model_name: str, status: str) -> None:
    try:
        INFERENCE_DOCUMENT_REQUESTS_TOTAL.labels(operation=operation, model=model_name, status=status).inc()
    except Exception:
        pass


def observe_document_plan(operation: str, model_name: str, input_chars: int, chunk_count: int) -> None:
    INFERENCE_DOCUMENT_INPUT_CHARS.labels(operation=operation, model=model_name).observe(input_chars)
    INFERENCE_DOCUMENT_CHUNK_COUNT.labels(operation=operation, model=model_name).observe(chunk_count)


def track_document_chunk_started(operation: str, model_name: str) -> None:
    INFERENCE_DOCUMENT_INFLIGHT_CHUNKS.labels(operation=operation, model=model_name).inc()


def track_document_chunk_finished(operation: str, model_name: str) -> None:
    INFERENCE_DOCUMENT_INFLIGHT_CHUNKS.labels(operation=operation, model=model_name).dec()


def record_document_chunk_processed(operation: str, model_name: str) -> None:
    INFERENCE_DOCUMENT_CHUNKS_PROCESSED_TOTAL.labels(operation=operation, model=model_name).inc()
