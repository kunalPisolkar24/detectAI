"""The facade the route calls and the factory main.py drives — the package's
composition root and its single branch point.

One class, one lifecycle: the service owns the instruments, the in-flight
state, the three adapters, and the drain. Splitting a dedicated telemetry
implementation out of it adds an indirection hop on every recording call for
no caller it serves — the route calls it the way it calls the validation
service (observability.md's seam view). opentelemetry imports live inside
this package alone; the contract ships none of them.
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

# The frozen instrument contract: these exact names keep the existing New
# Relic dashboards and terraform alerts working (observability.md's metric
# inventory). Renaming any of them is a contract migration, not a rename.
_INSTRUMENT_REJECTIONS = "rejected_uploads_total"        # Counter — reason
_INSTRUMENT_PARSED = "parsed_documents_total"            # Counter — mime_type, status
_INSTRUMENT_FAILURES = "extraction_failures_total"       # Counter — mime_type, error_type
_INSTRUMENT_TIMEOUTS = "extraction_timeouts_total"       # Counter — mime_type
_INSTRUMENT_DURATION = "extraction_duration_seconds"     # Histogram — mime_type, status
_INSTRUMENT_IN_FLIGHT = "in_flight_requests"             # ObservableGauge — no attributes

_UNREADABLE_ERROR = "unreadable_document"


class _InFlight:
    """The gauge's state: a lock-guarded count, sampled at export time.

    Guarded not because the event loop races but because a thawing Lambda
    instance may not share a thread (observability.md's instrument view).
    """

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
        """What the ObservableGauge's callback reads."""
        with self._lock:
            return self._count


class ObservabilityService:
    """The wired realization of the seam: records and drains its own adapters.

    Instruments are built once from the adapters' own provider objects —
    traces.provider().get_tracer(...) and metrics.meter() — never read back
    from the opentelemetry module globals; that is what keeps the
    in-memory-exporter tests possible without the network.
    """

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
        """Brackets the whole handler — rejections included — and feeds
        in_flight_requests. Emits no span of its own: the FastAPI
        instrumentation already owns the request span."""
        self._in_flight.begin()
        try:
            yield
        finally:
            self._in_flight.end()

    @contextmanager
    def track_extraction(self, mime_type: str) -> Iterator[None]:
        """Carries the extraction span with the mime attribute under its
        span; a raise exits the bracket with the span still closed."""
        with self._tracer.start_as_current_span(
            "extraction", attributes={"mime_type": mime_type}
        ):
            yield

    def record_rejection(self, reason: RejectionReason) -> None:
        """One add on rejected_uploads_total, reason attributed."""
        self._rejections.add(1, {"reason": reason})

    def record_extraction(
        self, mime_type: str, outcome: ExtractionOutcome, duration_seconds: float
    ) -> None:
        """One call per attempt; the service owns the fold so the route
        cannot record an inconsistent pair. A timeout is not also a failure,
        which is why dashboards can sum failures + timeouts without double
        counting (observability.md's verdict table)."""
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
        """The drain: spans → metrics → logs, one failure never skipping the
        next flush (per-adapter guard), and idempotent — three capped flushes
        fit the 12 s graceful drain the Dockerfile bounds."""
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
    """The NFR-5 gate: unset endpoint → nothing is emitted, nothing installed.

    The disabled build returns NullObservability — zero SDK objects — so dev
    is a silent no-op and the route keeps one code path with no `if endpoint`
    branches anywhere. An endpoint with a license key builds ready; whatever
    the factory cannot finish fails the boot, matching ConfigFactory.create
    and build_default_service — returned ready or the boot fails, never a
    half-built state between two phases.
    """
    # app is consumed only by the wired build (FastAPIInstrumentor takes it);
    # the disabled build installs nothing, so it is unused on this path.
    endpoint = settings.otel_exporter_otlp_endpoint
    if endpoint is None:
        return NullObservability()
    license_key = settings.new_relic_license_key
    # Settings' gate fails the boot when the endpoint rides without its key;
    # this guard only turns a bypassed gate into an immediate, named error.
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
    # Uvicorn's first app call is the lifespan probe, and Starlette builds
    # the middleware stack lazily inside that call — before this lifespan
    # body runs, so the served stack was built without the span middleware.
    # The wrapper captured the original plain builder at instrument time, so
    # rebuilding here puts the ASGI spans on the serving path exactly once.
    app.middleware_stack = app.build_middleware_stack()
    return ObservabilityService(traces=traces, metrics=metrics, logs=logs)
