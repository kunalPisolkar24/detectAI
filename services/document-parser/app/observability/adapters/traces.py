"""TracesAdapter: one TracerProvider, started against the shared Resource.

The exporter arrives injected so tests ride in-memory spans with no network;
sampling rides the dialable ratio and the batch's flush bound is whatever the
shutdown drain can afford inside the 12 s graceful window the Dockerfile
bounds (observability.md's shutdown view).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # The OTel SDK imports move to runtime when the deps land (build phase).
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SpanExporter


class TracesAdapter:
    """Starts once — the provider installs are global singletons, so a double
    start is a wiring bug and fails the boot loudly."""

    def __init__(self, span_exporter: SpanExporter, sample_ratio: float) -> None:
        self._span_exporter = span_exporter
        self._sample_ratio = sample_ratio
        self._provider: TracerProvider | None = None

    def start(self, resource: Resource) -> None:
        """TracerProvider(resource, sampler=ParentBased(TraceIdRatioBased))
        plus a BatchSpanProcessor over the injected exporter, set once."""
        raise NotImplementedError(
            "TODO(observability build): build the provider, batch the spans, install it"
        )

    def provider(self) -> TracerProvider:
        """The installed provider — instruments carry get_tracer through it,
        never through the opentelemetry module globals."""
        raise NotImplementedError(
            "TODO(observability build): return the started provider"
        )

    def shutdown(self) -> None:
        """Force-flush the queued spans; idempotent."""
        raise NotImplementedError(
            "TODO(observability build): idempotent force-flush"
        )
