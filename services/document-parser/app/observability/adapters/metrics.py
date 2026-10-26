"""MetricsAdapter: one MeterProvider, started against the shared Resource.

Delta temporality for counters and histograms is the New Relic OTLP best fit
for pushed data, and the periodic reader keeps the 15 s cadence the old
scrape interval established so dashboards see the same rhythm the pull model
used to give them (observability.md's export shape).
"""

from opentelemetry.metrics import Meter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    MetricExporter,
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource

# Per-flush cap: the three drain flushes must fit the 12 s graceful window.
_FLUSH_TIMEOUT_MILLIS = 5_000


class MetricsAdapter:
    """Starts once — the provider installs are global singletons, so a double
    start is a wiring bug and fails the boot loudly."""

    _DEFAULT_INTERVAL_MILLIS = 15_000

    def __init__(
        self,
        metric_exporter: MetricExporter,
        export_interval_millis: int = _DEFAULT_INTERVAL_MILLIS,
    ) -> None:
        self._metric_exporter = metric_exporter
        self._export_interval_millis = export_interval_millis
        self._provider: MeterProvider | None = None

    def start(self, resource: Resource) -> None:
        """MeterProvider over a periodic reader, set once — the reader's
        final collection fires at shutdown, whatever the interval awaits."""
        if self._provider is not None:
            raise RuntimeError("MetricsAdapter already started")
        reader = PeriodicExportingMetricReader(
            self._metric_exporter,
            export_interval_millis=self._export_interval_millis,
            export_timeout_millis=_FLUSH_TIMEOUT_MILLIS,
        )
        self._provider = MeterProvider(resource=resource, metric_readers=[reader])

    def meter(self) -> Meter:
        """The started provider's meter — the facade builds its instruments
        through this, never through the opentelemetry module globals."""
        if self._provider is None:
            raise RuntimeError("MetricsAdapter has no meter; start() first")
        return self._provider.get_meter(__name__)

    def shutdown(self) -> None:
        """Final metrics export; idempotent."""
        if self._provider is None:
            return
        provider = self._provider
        self._provider = None
        provider.shutdown()
