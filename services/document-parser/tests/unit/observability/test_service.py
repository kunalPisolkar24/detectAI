"""The facade over in-memory exporters: instrument names, the verdict folds,
the two brackets, and the drain — no network anywhere."""

import pytest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider

from app.observability.adapters import LogsAdapter, MetricsAdapter, TracesAdapter
from app.observability.service import ObservabilityService
from tests.unit.observability.memory import (
    MemoryLogExporter,
    MemoryMetricExporter,
    MemorySpanExporter,
)


class _StubAdapter:
    """Duck-typed for the drain tests: the service contract is the uniform
    shutdown shape, plus the provider/meter reads its constructor pulls."""

    def __init__(self, name: str, order: list[str], *, fail: bool = False) -> None:
        self._name = name
        self._order = order
        self._fail = fail
        self._done = False
        self._meter_provider = MeterProvider()

    def provider(self) -> TracerProvider:
        return TracerProvider()

    def meter(self):
        return self._meter_provider.get_meter("stub")

    def shutdown(self) -> None:
        if self._done:
            return
        self._done = True
        if self._fail:
            raise RuntimeError("flush died")
        self._order.append(self._name)


def _stub_pipeline(order: list[str], *, traces_fail: bool = False) -> ObservabilityService:
    return ObservabilityService(
        traces=_StubAdapter("traces", order, fail=traces_fail),
        metrics=_StubAdapter("metrics", order),
        logs=_StubAdapter("logs", order),
    )


@pytest.fixture(name="pipeline")
def _pipeline() -> tuple[ObservabilityService, tuple]:
    """The wired facade over three memory exporters; nothing is exported
    until a shutdown drain, which is how the tests read it back."""
    span_exporter = MemorySpanExporter()
    metric_exporter = MemoryMetricExporter()
    log_exporter = MemoryLogExporter()
    traces = TracesAdapter(span_exporter, sample_ratio=1.0)
    metrics = MetricsAdapter(metric_exporter, export_interval_millis=3600_000)
    logs = LogsAdapter(log_exporter)
    resource = Resource.create({"service.name": "document-parser"})
    traces.start(resource)
    metrics.start(resource)
    logs.start(resource)
    service = ObservabilityService(traces=traces, metrics=metrics, logs=logs)
    return service, (span_exporter, metric_exporter, log_exporter)


def _metric_points(exporter: MemoryMetricExporter) -> dict[str, list[tuple[dict, object]]]:
    points: dict[str, list[tuple[dict, object]]] = {}
    for batch in exporter.batches:
        for resource_batch in batch.resource_metrics:
            for scope_batch in resource_batch.scope_metrics:
                for metric in scope_batch.metrics:
                    for point in metric.data.data_points:
                        points.setdefault(metric.name, []).append(
                            (dict(point.attributes), point)
                        )
    return points


def _typed(entries: list[tuple[dict, object]]) -> dict[tuple, object]:
    return {tuple(sorted(attributes.items())): point for attributes, point in entries}


def test_record_extraction_folds_the_four_outcomes(pipeline) -> None:
    service, (_, metric_exporter, _) = pipeline

    service.record_extraction("application/pdf", "ok", 0.5)
    service.record_extraction("application/pdf", "truncated", 1.0)
    service.record_extraction("application/pdf", "timeout", 2.0)
    service.record_extraction("application/vnd.ms-word", "unreadable", 3.0)
    service.shutdown()

    points = _metric_points(metric_exporter)
    # the gauge rides every final collection, so the fold owns four names
    assert points.keys() == {
        "parsed_documents_total",
        "extraction_timeouts_total",
        "extraction_failures_total",
        "extraction_duration_seconds",
        "in_flight_requests",
    }
    parsed = _typed(points["parsed_documents_total"])
    assert parsed[(("mime_type", "application/pdf"), ("status", "ok"))].value == 1
    assert parsed[(("mime_type", "application/pdf"), ("status", "truncated"))].value == 1
    (timed,) = points["extraction_timeouts_total"]
    assert timed[0] == {"mime_type": "application/pdf"} and timed[1].value == 1
    (failed,) = points["extraction_failures_total"]
    assert failed[0] == {
        "mime_type": "application/vnd.ms-word",
        "error_type": "unreadable_document",
    } and failed[1].value == 1
    durations = _typed(points["extraction_duration_seconds"])
    assert sorted(point.sum for point in durations.values()) == [0.5, 1.0, 2.0, 3.0]


def test_rejections_carry_the_reason(pipeline) -> None:
    service, (_, metric_exporter, _) = pipeline

    service.record_rejection("too_large")
    service.record_rejection("corrupt")
    service.shutdown()

    rejected = _typed(_metric_points(metric_exporter)["rejected_uploads_total"])
    assert rejected[(("reason", "corrupt"),)].value == 1
    assert rejected[(("reason", "too_large"),)].value == 1


def test_the_request_bracket_feeds_the_gauge_while_open(pipeline) -> None:
    service, (_, metric_exporter, _) = pipeline

    # one caller may nest another: two brackets, gauge reads 2
    with service.track_request(), service.track_request():
        service.shutdown()

    gauge = _metric_points(metric_exporter)["in_flight_requests"]
    assert gauge[0][1].value == 2


def test_the_extraction_span_carries_the_mime_and_size(pipeline) -> None:
    service, (span_exporter, _, _) = pipeline

    with service.track_extraction("application/pdf", 1_048_576):
        pass
    service.shutdown()

    assert [span.name for span in span_exporter.finished_spans] == ["extraction"]
    assert span_exporter.finished_spans[0].attributes == {
        "mime_type": "application/pdf",
        "document_size_bytes": 1_048_576,
    }


def test_the_extraction_span_still_closes_on_a_raise(pipeline) -> None:
    service, (span_exporter, _, _) = pipeline

    with (
        pytest.raises(RuntimeError, match="the parse died"),
        service.track_extraction("text/plain", 37),
    ):
        raise RuntimeError("the parse died")
    service.shutdown()

    (span,) = span_exporter.finished_spans
    assert span.attributes == {
        "mime_type": "text/plain",
        "document_size_bytes": 37,
    }
    assert span.status.status_code.name == "ERROR"


def test_the_drain_runs_spans_first_then_metrics_then_logs() -> None:
    order: list[str] = []
    service = _stub_pipeline(order)

    service.shutdown()

    assert order == ["traces", "metrics", "logs"]


def test_the_drain_keeps_going_when_a_flush_dies() -> None:
    order: list[str] = []
    service = _stub_pipeline(order, traces_fail=True)

    service.shutdown()

    assert order == ["metrics", "logs"]


def test_the_drain_is_idempotent() -> None:
    order: list[str] = []
    service = _stub_pipeline(order)

    service.shutdown()
    service.shutdown()

    assert order == ["traces", "metrics", "logs"]
