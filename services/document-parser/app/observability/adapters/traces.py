"""Traces adapter: one TracerProvider started against the shared Resource; the exporter arrives injected."""

from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SpanExporter
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

# Per-flush cap: the three drain flushes must fit the 12 s graceful window.
_FLUSH_TIMEOUT_MILLIS = 5_000


class TracesAdapter:
    """Starts once — the provider installs are global singletons, so a double
    start is a wiring bug and fails the boot loudly."""

    def __init__(self, span_exporter: SpanExporter, sample_ratio: float) -> None:
        self._span_exporter = span_exporter
        self._sample_ratio = sample_ratio
        self._provider: TracerProvider | None = None
        self._processor: BatchSpanProcessor | None = None

    def start(self, resource: Resource) -> None:
        if self._provider is not None:
            raise RuntimeError("TracesAdapter already started")
        provider = TracerProvider(
            resource=resource,
            sampler=ParentBased(TraceIdRatioBased(self._sample_ratio)),
        )
        processor = BatchSpanProcessor(
            self._span_exporter, export_timeout_millis=_FLUSH_TIMEOUT_MILLIS
        )
        provider.add_span_processor(processor)
        self._processor = processor
        self._provider = provider

    def provider(self) -> TracerProvider:
        """Consumers receive it by injection — the OTel global registry stays untouched."""
        if self._provider is None:
            raise RuntimeError("TracesAdapter has no provider; start() first")
        return self._provider

    def shutdown(self) -> None:
        """Force-flush then stop; the stop is what kills the retrying worker."""
        if self._provider is None:
            return
        provider = self._provider
        processor = self._processor
        self._provider = None
        self._processor = None
        try:
            provider.force_flush(timeout_millis=_FLUSH_TIMEOUT_MILLIS)
        finally:
            # A flush failure must not skip the stop — the worker would keep retrying.
            processor.shutdown()
