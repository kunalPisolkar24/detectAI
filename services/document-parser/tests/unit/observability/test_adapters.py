"""The three signal adapters: start-once guard, idempotent shutdown, and the
data they hand their injected exporter — all without a network."""

import logging
from collections.abc import Iterator

import pytest
from opentelemetry.sdk.resources import Resource

from app.observability.adapters import (
    LogsAdapter,
    MetricsAdapter,
    TracesAdapter,
)
from app.observability.adapters.logs import _UVICORN_LOGGERS
from tests.unit.observability.memory import (
    MemoryLogExporter,
    MemoryMetricExporter,
    MemorySpanExporter,
)


@pytest.fixture(name="resource")
def _resource() -> Resource:
    return Resource.create({"service.name": "document-parser"})


@pytest.fixture(name="app_log")
def _app_log() -> Iterator[logging.Logger]:
    # The logger the app logs to; in prod main.py's basicConfig(level=INFO)
    # is the root gate, so the test logger carries the equivalent level.
    logger = logging.getLogger("app.test.subject")
    logger.setLevel(logging.INFO)
    yield logger
    logger.setLevel(logging.NOTSET)


def test_traces_adapter_flushes_its_spans_on_shutdown(resource: Resource) -> None:
    exporter = MemorySpanExporter()
    adapter = TracesAdapter(exporter, sample_ratio=1.0)

    adapter.start(resource)
    with adapter.provider().get_tracer("test").start_span("one") as span:
        span.set_attribute("mime_type", "application/pdf")
    adapter.shutdown()

    assert [span.name for span in exporter.finished_spans] == ["one"]
    assert exporter.finished_spans[0].attributes["mime_type"] == "application/pdf"


def test_traces_adapter_rejects_a_double_start(resource: Resource) -> None:
    adapter = TracesAdapter(MemorySpanExporter(), sample_ratio=1.0)

    adapter.start(resource)
    with pytest.raises(RuntimeError, match="already started"):
        adapter.start(resource)


def test_traces_adapter_shutdown_is_idempotent(resource: Resource) -> None:
    adapter = TracesAdapter(MemorySpanExporter(), sample_ratio=1.0)

    adapter.start(resource)
    adapter.shutdown()
    adapter.shutdown()

    with pytest.raises(RuntimeError, match="no provider"):
        adapter.provider()


def test_metrics_adapter_exports_a_final_batch_on_shutdown(
    resource: Resource,
) -> None:
    exporter = MemoryMetricExporter()
    adapter = MetricsAdapter(exporter, export_interval_millis=3600_000)

    adapter.start(resource)
    counter = adapter.meter().create_counter("tally")
    counter.add(1, {"mime_type": "application/pdf"})
    adapter.shutdown()

    assert [(metric.name, [dict(point.attributes) for point in metric.data.data_points])
            for batch in exporter.batches
            for resource_batch in batch.resource_metrics
            for scope_batch in resource_batch.scope_metrics
            for metric in scope_batch.metrics] == [
        ("tally", [{"mime_type": "application/pdf"}]),
    ]


def test_metrics_adapter_rejects_a_double_start(resource: Resource) -> None:
    adapter = MetricsAdapter(MemoryMetricExporter())

    adapter.start(resource)
    with pytest.raises(RuntimeError, match="already started"):
        adapter.start(resource)


def test_metrics_adapter_shutdown_is_idempotent(resource: Resource) -> None:
    adapter = MetricsAdapter(MemoryMetricExporter())

    adapter.start(resource)
    adapter.shutdown()
    adapter.shutdown()

    with pytest.raises(RuntimeError, match="no meter"):
        adapter.meter()


def test_logs_adapter_flushes_its_records_on_shutdown(
    resource: Resource, app_log: logging.Logger
) -> None:
    exporter = MemoryLogExporter()
    adapter = LogsAdapter(exporter)

    adapter.start(resource)
    app_log.info("payload ready")
    adapter.shutdown()

    assert any("payload ready" in str(record.log_record.body) for record in exporter.finished_records)


def test_logs_adapter_detaches_its_handler_from_the_root_logger(
    resource: Resource, app_log: logging.Logger
) -> None:
    exporter = MemoryLogExporter()
    adapter = LogsAdapter(exporter)

    adapter.start(resource)
    app_log.info("before the drain")
    adapter.shutdown()
    flushed = len(exporter.finished_records)

    app_log.info("after the drain")
    assert len(exporter.finished_records) == flushed


def test_logs_adapter_rejects_a_double_start(resource: Resource) -> None:
    adapter = LogsAdapter(MemoryLogExporter())

    adapter.start(resource)
    with pytest.raises(RuntimeError, match="already started"):
        adapter.start(resource)


def test_logs_adapter_shutdown_is_idempotent(resource: Resource) -> None:
    adapter = LogsAdapter(MemoryLogExporter())

    adapter.start(resource)
    adapter.shutdown()
    adapter.shutdown()


@pytest.mark.parametrize("name", _UVICORN_LOGGERS)
def test_the_uvicorn_loggers_are_cut_from_the_otel_path(
    resource: Resource, name: str
) -> None:
    adapter = LogsAdapter(MemoryLogExporter())

    adapter.start(resource)
    assert logging.getLogger(name).propagate is False

    adapter.shutdown()
