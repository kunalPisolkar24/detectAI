"""In-memory exporters: the adapter and service tests' seam — nothing
reaches a network. Each exporter records exactly what the SDK hands it."""

from opentelemetry.sdk._logs._internal.export import LogRecordExportResult
from opentelemetry.sdk._logs.export import LogRecordExporter
from opentelemetry.sdk.metrics.export import (
    MetricExporter,
    MetricExportResult,
)
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult


class MemorySpanExporter(SpanExporter):
    def __init__(self) -> None:
        self.finished_spans: list = []

    def export(self, spans) -> SpanExportResult:
        self.finished_spans.extend(spans)
        return SpanExportResult.SUCCESS


class MemoryMetricExporter(MetricExporter):
    def __init__(self) -> None:
        super().__init__()
        self.batches: list = []
        self.flushes = 0

    def export(self, metrics_data, timeout_millis: float = 10_000, **kwargs):
        self.batches.append(metrics_data)
        return MetricExportResult.SUCCESS

    def force_flush(self, timeout_millis: float = 10_000) -> bool:
        self.flushes += 1
        return True

    def shutdown(self, timeout: float = 30_000, **kwargs) -> None:
        # The periodic reader times out the exporter's shutdown call itself.
        return None


class MemoryLogExporter(LogRecordExporter):
    def __init__(self) -> None:
        self.finished_records: list = []
        self.flushes = 0

    def export(self, batch) -> LogRecordExportResult:
        self.finished_records.extend(batch)
        return LogRecordExportResult.SUCCESS

    def force_flush(self, timeout_millis: int | None = None) -> bool:
        self.flushes += 1
        return True

    def shutdown(self) -> None:
        return None
