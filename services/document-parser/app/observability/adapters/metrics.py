"""MetricsAdapter: one MeterProvider, started against the shared Resource.

Delta temporality for counters and histograms is the New Relic OTLP best fit
for pushed data, and the reader keeps the 15 s cadence the old scrape interval
established so dashboards see the same rhythm the pull model used to give
them (observability.md's export shape).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    # The OTel SDK imports move to runtime when the deps land (build phase).
    from opentelemetry.metrics import Meter
    from opentelemetry.sdk.metrics.export import MetricExporter
    from opentelemetry.sdk.resources import Resource


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
        self._provider = None  # MeterProvider, built in start()

    def start(self, resource: Resource) -> None:
        """MeterProvider(resource) over a PeriodicExportingMetricReader with
        delta temporality and the injected interval, set once."""
        raise NotImplementedError(
            "TODO(observability build): build the reader (delta) and the provider, install it"
        )

    def meter(self) -> Meter:
        """The started provider's meter — the facade builds its instruments
        through this, never through the opentelemetry module globals."""
        raise NotImplementedError(
            "TODO(observability build): return the started meter"
        )

    def shutdown(self) -> None:
        """Final metrics export; idempotent."""
        raise NotImplementedError(
            "TODO(observability build): idempotent final export"
        )
