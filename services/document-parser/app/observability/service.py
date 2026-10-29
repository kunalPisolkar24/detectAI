"""The observability service itself: instruments, in-flight gauge, drain.

One class rather than a split telemetry layer: no caller wants the extra
hop, and the package is the only place that imports opentelemetry.
"""

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING

from opentelemetry.exporter.otlp.proto.http import Compression
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.metrics import Meter, Observation
from opentelemetry.sdk.metrics import Counter, Histogram
from opentelemetry.sdk.metrics.export import AggregationTemporality
from opentelemetry.trace import Tracer

from ..config import Settings, deployment_flick
from .adapters import LogsAdapter, MetricsAdapter, TracesAdapter
from .contract import (
    ExtractionOutcome,
    NullObservability,
    Observability,
    RejectionReason,
)
from .otlp import headers, logs_url, metrics_url, traces_url
from .resource import build_resource

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)

# Frozen names: the New Relic dashboards and terraform alerts depend on
# them — renaming is a migration, not an edit.
_INSTRUMENT_REJECTIONS = "rejected_uploads_total"        # Counter — reason
_INSTRUMENT_PARSED = "parsed_documents_total"            # Counter — mime_type, status
_INSTRUMENT_FAILURES = "extraction_failures_total"       # Counter — mime_type, error_type
_INSTRUMENT_TIMEOUTS = "extraction_timeouts_total"       # Counter — mime_type
_INSTRUMENT_DURATION = "extraction_duration_seconds"     # Histogram — mime_type, status
_INSTRUMENT_IN_FLIGHT = "in_flight_requests"             # ObservableGauge — no attributes

_UNREADABLE_ERROR = "unreadable_document"


class _InFlight:
    """Lock-guarded: not an event-loop race, but a thawed Lambda may share nothing."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._count = 0

    def begin(self) -> None:
        with self._lock:
            self._count += 1

    def end(self) -> None:
        with self._lock:
            self._count -= 1

    def value(self) -> int:
        with self._lock:
            return self._count


class ObservabilityService:
    """Instruments build from the adapters' own providers, never OTel globals."""

    def __init__(
        self,
        *,
        traces: TracesAdapter,
        metrics: MetricsAdapter,
        logs: LogsAdapter,
    ) -> None:
        self._traces = traces
        self._metrics = metrics
        self._logs = logs
        self._in_flight = _InFlight()
        self._tracer: Tracer = traces.provider().get_tracer(__name__)
        meter: Meter = metrics.meter()
        self._rejections: Counter = meter.create_counter(_INSTRUMENT_REJECTIONS)
        self._parsed: Counter = meter.create_counter(_INSTRUMENT_PARSED)
        self._failures: Counter = meter.create_counter(_INSTRUMENT_FAILURES)
        self._timeouts: Counter = meter.create_counter(_INSTRUMENT_TIMEOUTS)
        self._duration: Histogram = meter.create_histogram(
            _INSTRUMENT_DURATION, unit="s"
        )
        meter.create_observable_gauge(
            _INSTRUMENT_IN_FLIGHT, callbacks=[self._in_flight_value]
        )

    def _in_flight_value(self, _options: object) -> Iterator[Observation]:
        yield Observation(self._in_flight.value())

    @contextmanager
    def track_request(self) -> Iterator[None]:
        """Gauge bracket only — no span; FastAPI instrumentation owns the request span."""
        self._in_flight.begin()
        try:
            yield
        finally:
            self._in_flight.end()

    @contextmanager
    def track_extraction(
        self, mime_type: str, document_size_bytes: int
    ) -> Iterator[None]:
        with self._tracer.start_as_current_span(
            "extraction",
            attributes={
                "mime_type": mime_type,
                "document_size_bytes": document_size_bytes,
            },
        ):
            yield

    def record_rejection(self, reason: RejectionReason) -> None:
        self._rejections.add(1, {"reason": reason})

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        """Timeout is not also a failure, so sums of the counters never double count."""
        verdict = {"mime_type": mime_type, "status": outcome}
        if outcome in ("ok", "truncated"):
            self._parsed.add(1, verdict)
        elif outcome == "timeout":
            self._timeouts.add(1, {"mime_type": mime_type})
        elif outcome == "unreadable":
            self._failures.add(
                1, {"mime_type": mime_type, "error_type": _UNREADABLE_ERROR}
            )
        self._duration.record(duration_seconds, verdict)

    def shutdown(self) -> None:
        """Spans -> metrics -> logs, per-adapter guarded and idempotent."""
        for adapter in (self._traces, self._metrics, self._logs):
            try:
                adapter.shutdown()
            except Exception:
                logger.warning(
                    "observability drain: %s flush failed",
                    type(adapter).__name__,
                    exc_info=True,
                )


def build_observability_service(settings: Settings, app: "FastAPI") -> Observability:
    """Unset endpoint -> NullObservability (zero SDK objects); otherwise build ready or fail the boot."""
    # app is only consumed by the wired build; the disabled path installs nothing.
    endpoint = settings.otel_exporter_otlp_endpoint
    if endpoint is None:
        return NullObservability()
    license_key = settings.new_relic_license_key
    # Catches a bypassed Settings gate with an immediate, named error.
    if license_key is None:
        raise RuntimeError("an OTLP endpoint demands its ingest license key")
    resource = build_resource(
        settings.otel_service_name,
        settings.otel_service_version or "dev",
        deployment_flick(),
    )
    traces = TracesAdapter(
        OTLPSpanExporter(
            endpoint=traces_url(endpoint),
            headers=headers(license_key),
            compression=Compression.Gzip,
        ),
        sample_ratio=settings.otel_trace_sample_ratio,
    )
    metrics = MetricsAdapter(
        OTLPMetricExporter(
            endpoint=metrics_url(endpoint),
            headers=headers(license_key),
            compression=Compression.Gzip,
            preferred_temporality={
                Counter: AggregationTemporality.DELTA,
                Histogram: AggregationTemporality.DELTA,
            },
        ),
    )
    logs = LogsAdapter(
        OTLPLogExporter(
            endpoint=logs_url(endpoint),
            headers=headers(license_key),
            compression=Compression.Gzip,
        ),
    )
    traces.start(resource)
    metrics.start(resource)
    logs.start(resource)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=traces.provider())
    # Starlette builds the middleware stack lazily inside the lifespan probe,
    # so rebuilding once here puts the ASGI spans on the serving path.
    app.middleware_stack = app.build_middleware_stack()
    return ObservabilityService(traces=traces, metrics=metrics, logs=logs)
