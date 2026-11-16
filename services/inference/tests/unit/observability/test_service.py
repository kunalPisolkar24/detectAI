"""The facade over in-memory exporters: instrument names, the gauges, the
model annotation, the brackets, and the drain — no network anywhere."""

import time

import pytest
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import StatusCode

from app.observability.adapters import LogsAdapter, MetricsAdapter, TracesAdapter
from app.observability.service import ObservabilityService
from tests.unit.observability.memory import (
    MemoryLogExporter,
    MemoryMetricExporter,
    MemorySpanExporter,
)

_REVISION = "b0ab87257cc240d66622c2482270ec726e16c553"


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
    resource = Resource.create({"service.name": "inference"})
    traces.start(resource)
    metrics.start(resource)
    logs.start(resource)
    service = ObservabilityService(traces=traces, metrics=metrics, logs=logs)
    return service, (span_exporter, metric_exporter, log_exporter)


@pytest.fixture(name="live_pipeline")
def _live_pipeline() -> tuple[ObservabilityService, tuple]:
    """The same facade over a reader that collects on its own, so the
    observable gauges can be read while their brackets are open."""
    span_exporter = MemorySpanExporter()
    metric_exporter = MemoryMetricExporter()
    log_exporter = MemoryLogExporter()
    traces = TracesAdapter(span_exporter, sample_ratio=1.0)
    metrics = MetricsAdapter(metric_exporter, export_interval_millis=20)
    logs = LogsAdapter(log_exporter)
    resource = Resource.create({"service.name": "inference"})
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


def _latest_points(exporter: MemoryMetricExporter) -> dict[str, list[tuple[dict, object]]]:
    """The most recent collection: the gauges are read at collection time."""
    if not exporter.batches:
        return {}
    batch = exporter.batches[-1]
    points: dict[str, list[tuple[dict, object]]] = {}
    for resource_batch in batch.resource_metrics:
        for scope_batch in resource_batch.scope_metrics:
            for metric in scope_batch.metrics:
                for point in metric.data.data_points:
                    points.setdefault(metric.name, []).append(
                        (dict(point.attributes), point)
                    )
    return points


def _await_collection(exporter: MemoryMetricExporter, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline and not exporter.batches:
        time.sleep(0.01)


def test_the_instrument_set_is_the_frozen_one(pipeline) -> None:
    service, (_, metric_exporter, _) = pipeline

    # The histogram only reaches the wire with a measurement behind it.
    service.record_engine_duration("spark", 0.1)
    service.shutdown()

    assert set(_metric_points(metric_exporter)) == {
        "inference_batch_size",
        "inference_queue_depth",
        "inference_inflight_chunks",
        "inference_engine_duration_seconds",
    }


def test_the_gauges_report_the_live_shape(live_pipeline) -> None:
    service, (_, metric_exporter, _) = live_pipeline

    with service.track_document(), service.track_batch(4):
        metric_exporter.batches.clear()
        _await_collection(metric_exporter)
        # Read the collection while the brackets are open: the gauges are
        # sampled at collection time, not when they are set.
        points = _latest_points(metric_exporter)
    service.shutdown()

    assert points["inference_queue_depth"][0][1].value == 1
    assert points["inference_inflight_chunks"][0][1].value == 4
    assert points["inference_batch_size"][0][1].value == 4


def test_the_gauges_return_to_zero_when_the_brackets_close(live_pipeline) -> None:
    service, (_, metric_exporter, _) = live_pipeline

    with service.track_document(), service.track_batch(4):
        metric_exporter.batches.clear()
        _await_collection(metric_exporter)
    metric_exporter.batches.clear()
    _await_collection(metric_exporter)
    points = _latest_points(metric_exporter)
    service.shutdown()

    assert points["inference_queue_depth"][0][1].value == 0
    assert points["inference_inflight_chunks"][0][1].value == 0


def test_the_engine_duration_carries_the_model(pipeline) -> None:
    service, (_, metric_exporter, _) = pipeline

    service.record_engine_duration("spark", 0.25)
    service.record_engine_duration("spark", 0.75)
    service.shutdown()

    points = _metric_points(metric_exporter)
    entries = points["inference_engine_duration_seconds"]
    assert len(entries) == 1
    attributes, point = entries[0]
    assert attributes == {"model": "spark"}
    assert point.count == 2
    assert point.sum == pytest.approx(1.0)


def test_the_model_is_folded_onto_the_current_span(pipeline) -> None:
    service, (span_exporter, _, _) = pipeline
    traces = service._traces

    with traces.provider().get_tracer("test").start_as_current_span("rpc"):
        service.annotate_model("spark", _REVISION, "CUDAExecutionProvider")
    service.shutdown()

    span = span_exporter.finished_spans[0]
    assert span.attributes["model.id"] == "spark"
    assert span.attributes["model.revision"] == _REVISION
    assert span.attributes["inference.provider"] == "CUDAExecutionProvider"


def test_annotating_outside_a_span_is_harmless(pipeline) -> None:
    service, (_, _, _) = pipeline

    service.annotate_model("spark", _REVISION, "CUDAExecutionProvider")

    service.shutdown()


def test_a_failed_call_marks_the_span_failed(pipeline) -> None:
    service, (span_exporter, _, _) = pipeline
    traces = service._traces

    with traces.provider().get_tracer("test").start_as_current_span("rpc"):
        service.mark_failed("RESOURCE_EXHAUSTED")
    service.shutdown()

    span = span_exporter.finished_spans[0]
    assert span.status.status_code is StatusCode.ERROR
    assert span.status.description == "RESOURCE_EXHAUSTED"


def test_marking_outside_a_span_is_harmless(pipeline) -> None:
    service, (_, _, _) = pipeline

    service.mark_failed("INTERNAL")

    service.shutdown()


def test_the_batch_bracket_closes_on_a_raise(pipeline) -> None:
    service, (_, metric_exporter, _) = pipeline

    with pytest.raises(RuntimeError), service.track_batch(2):
        raise RuntimeError("the engine died")

    service.shutdown()

    points = _latest_points(metric_exporter)
    assert points["inference_inflight_chunks"][0][1].value == 0


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
