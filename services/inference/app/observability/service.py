"""The observability service itself: instruments, gauges, drain.

One class rather than a split telemetry layer: no caller wants the extra
hop, and the package is the only place that imports opentelemetry.
"""

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

import grpc
from grpc import aio
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http import Compression
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.grpc import aio_server_interceptor, filters
from opentelemetry.metrics import Meter, Observation
from opentelemetry.sdk.metrics import Histogram
from opentelemetry.sdk.metrics.export import AggregationTemporality
from opentelemetry.trace import Status, StatusCode

from .adapters import LogsAdapter, MetricsAdapter, TracesAdapter
from .contract import NullObservability, Observability
from .otlp import headers, logs_url, metrics_url, traces_url
from .resource import build_resource

if TYPE_CHECKING:
    from ..config import Settings

logger = logging.getLogger(__name__)

# Frozen names: the New Relic dashboards and terraform alerts depend on
# them — renaming is a migration, not an edit.
_INSTRUMENT_BATCH_SIZE = "inference_batch_size"             # ObservableGauge — no attributes
_INSTRUMENT_QUEUE_DEPTH = "inference_queue_depth"           # ObservableGauge — no attributes
_INSTRUMENT_INFLIGHT_CHUNKS = "inference_inflight_chunks"   # ObservableGauge — no attributes
_INSTRUMENT_ENGINE_DURATION = "inference_engine_duration_seconds"  # Histogram — model

# The span attributes the board's per-model panel facets on.
_ATTRIBUTE_MODEL_ID = "model.id"
_ATTRIBUTE_MODEL_REVISION = "model.revision"
_ATTRIBUTE_PROVIDER = "inference.provider"

# The services that answer probes and the schema, never inference traffic.
_PROBE_SERVICES = ("grpc.health.v1.Health", "grpc.reflection.v1alpha.ServerReflection")


def _is_inference_traffic(details: grpc.HandlerCallDetails) -> bool:
    """Keep the health check and the reflection schema out of the traffic panels."""
    probes = filters.any_of(*(filters.service_prefix(name) for name in _PROBE_SERVICES))
    return not probes(details)


class _Gauge:
    """Lock-guarded: the use case runs on the event loop, but a thawed pool may share nothing."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._value = 0

    def add(self, delta: int) -> None:
        with self._lock:
            self._value += delta

    def set(self, value: int) -> None:
        with self._lock:
            self._value = value

    def value(self) -> int:
        with self._lock:
            return self._value


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
        self._queue_depth = _Gauge()
        self._inflight_chunks = _Gauge()
        self._batch_size = _Gauge()
        meter: Meter = metrics.meter()
        self._engine_duration: Histogram = meter.create_histogram(
            _INSTRUMENT_ENGINE_DURATION, unit="s"
        )
        meter.create_observable_gauge(
            _INSTRUMENT_BATCH_SIZE, callbacks=[self._batch_size_value]
        )
        meter.create_observable_gauge(
            _INSTRUMENT_QUEUE_DEPTH, callbacks=[self._queue_depth_value]
        )
        meter.create_observable_gauge(
            _INSTRUMENT_INFLIGHT_CHUNKS, callbacks=[self._inflight_chunks_value]
        )

    def _batch_size_value(self, _options: object) -> Iterator[Observation]:
        yield Observation(self._batch_size.value())

    def _queue_depth_value(self, _options: object) -> Iterator[Observation]:
        yield Observation(self._queue_depth.value())

    def _inflight_chunks_value(self, _options: object) -> Iterator[Observation]:
        yield Observation(self._inflight_chunks.value())

    def annotate_model(self, model_id: str, revision: str, provider: str) -> None:
        """Fold the serving model onto the live span; the board facets on it.

        The current span is read from the ambient context, not from a tracer:
        the gRPC instrumentation owns the request span and this only decorates it.
        """
        span = trace.get_current_span()
        span.set_attribute(_ATTRIBUTE_MODEL_ID, model_id)
        span.set_attribute(_ATTRIBUTE_MODEL_REVISION, revision)
        span.set_attribute(_ATTRIBUTE_PROVIDER, provider)

    def mark_failed(self, reason: str) -> None:
        """Mark the live span failed.

        The gRPC instrumentation marks only a handful of statuses as failed, so
        the contract's own codes would reach the board as successes and the
        error share would miss them.
        """
        span = trace.get_current_span()
        span.set_status(Status(StatusCode.ERROR, description=reason))

    @contextmanager
    def track_document(self) -> Iterator[None]:
        """Gauge bracket only — no span; the gRPC instrumentation owns the request span."""
        self._queue_depth.add(1)
        try:
            yield
        finally:
            self._queue_depth.add(-1)

    @contextmanager
    def track_batch(self, size: int) -> Iterator[None]:
        """The width of the batch, and the chunks it holds while the engine runs."""
        self._batch_size.set(size)
        self._inflight_chunks.add(size)
        try:
            yield
        finally:
            self._inflight_chunks.add(-size)

    def record_engine_duration(self, model_id: str, seconds: float) -> None:
        """The forward pass of one batch; the model attribute keeps the series unbroken
        across a revision bump."""
        self._engine_duration.record(seconds, {"model": model_id})

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


@dataclass(frozen=True)
class ObservabilityWiring:
    """What the boot needs: the seam to inject, and the interceptor for the server."""

    observability: Observability
    server_interceptor: aio.ServerInterceptor | None


def build_observability_service(settings: "Settings", environment: str) -> ObservabilityWiring:
    """Unset endpoint -> the null seam (zero SDK objects); otherwise build ready or fail the boot."""
    endpoint = settings.otel_exporter_otlp_endpoint
    if endpoint is None:
        return ObservabilityWiring(
            observability=NullObservability(), server_interceptor=None
        )
    license_key = settings.new_relic_license_key
    # Catches a bypassed Settings gate with an immediate, named error.
    if license_key is None:
        raise RuntimeError("an OTLP endpoint demands its ingest license key")
    resource = build_resource(
        settings.otel_service_name,
        settings.otel_service_version or "dev",
        environment,
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
    interceptor = aio_server_interceptor(
        tracer_provider=traces.provider(),
        filter_=_is_inference_traffic,
    )
    return ObservabilityWiring(
        observability=ObservabilityService(traces=traces, metrics=metrics, logs=logs),
        server_interceptor=interceptor,
    )
