"""TracesAdapter: one TracerProvider, started against the shared Resource.

The exporter arrives injected so tests ride in-memory spans with no network;
sampling rides the dialable ratio and the batch's flush bound is whatever the
shutdown drain can afford inside the 12 s graceful window the Dockerfile
bounds (observability.md's shutdown view).
"""

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

    def start(self, resource: Resource) -> None:
        """A ratio-sampled provider over a batch processor, set once."""
        if self._provider is not None:
            raise RuntimeError("TracesAdapter already started")
        provider = TracerProvider(
            resource=resource,
            sampler=ParentBased(TraceIdRatioBased(self._sample_ratio)),
        )
        provider.add_span_processor(
            BatchSpanProcessor(
                self._span_exporter, export_timeout_millis=_FLUSH_TIMEOUT_MILLIS
            )
        )
        self._provider = provider

    def provider(self) -> TracerProvider:
        """The started provider — consumers take it explicitly, the OTel
        global registry stays untouched (instrument_app, the service, tests
        all receive it by injection)."""
        if self._provider is None:
            raise RuntimeError("TracesAdapter has no provider; start() first")
        return self._provider

    def shutdown(self) -> None:
        """Force-flush the queued spans; idempotent."""
        if self._provider is None:
            return
        provider = self._provider
        self._provider = None
        provider.force_flush(timeout_millis=_FLUSH_TIMEOUT_MILLIS)
