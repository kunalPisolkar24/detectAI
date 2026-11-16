"""The wired observability build on the production gRPC boot: the spans the
board reads, and the probes the filter keeps out. The real OTLP exporters
post to a local receiver, so the wire shape is asserted as it lands — and
nothing leaves the machine.
"""

import asyncio
import gzip
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import grpc
import pytest
from grpc import aio
from grpc_health.v1 import health_pb2, health_pb2_grpc
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import (
    ExportLogsServiceRequest,
)
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)

from app.config import Settings
from app.observability import build_observability_service
from app.serving.generated import ai_service_pb2 as pb
from app.serving.generated import ai_service_pb2_grpc
from app.serving.server import _build, _serve_until_stopped

from .conftest import BlockingEngine, StubEngine, build_analysis

_BOOT_KEY = "observability-boot-key"
_RECEIVED: dict[str, list[bytes]] = {}


class _Collector(BaseHTTPRequestHandler):
    """Keeps the OTLP payloads whole — the test reads the wire shape."""

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0") or 0)
        body = self.rfile.read(length)
        if self.headers.get("content-encoding") == "gzip":
            body = gzip.decompress(body)
        signal = self.path.rsplit("/", 1)[-1]
        _RECEIVED.setdefault(signal, []).append(body)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args: object) -> None:
        """Silence the access line; quietness is the fixture's point."""


@pytest.fixture(scope="module")
def receiver() -> str:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Collector)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _settings(endpoint: str) -> Settings:
    return Settings.model_validate(
        {
            "api_key": "a" * 20,
            "otel_exporter_otlp_endpoint": endpoint,
            "new_relic_license_key": "d" * 20,
            "otel_service_name": "inference",
        }
    )


def _spans() -> list:
    """The spans the receiver was sent, flattened out of the OTLP envelope."""
    spans = []
    for body in _RECEIVED.get("traces", []):
        request = ExportTraceServiceRequest.FromString(body)
        for resource_spans in request.resource_spans:
            for scope_spans in resource_spans.scope_spans:
                spans.extend(scope_spans.spans)
    return spans


def _metric_names() -> set[str]:
    """The instrument names the wired build exported at the local receiver."""
    names: set[str] = set()
    for body in _RECEIVED.get("metrics", []):
        request = ExportMetricsServiceRequest.FromString(body)
        for resource in request.resource_metrics:
            for scope in resource.scope_metrics:
                names.update(metric.name for metric in scope.metrics)
    return names


def _log_bodies() -> list[str]:
    """The log records the wired build exported at the local receiver."""
    bodies: list[str] = []
    for body in _RECEIVED.get("logs", []):
        request = ExportLogsServiceRequest.FromString(body)
        for resource in request.resource_logs:
            for scope in resource.scope_logs:
                bodies.extend(record.body.string_value for record in scope.log_records)
    return bodies


def _attributes(span) -> dict[str, object]:
    return {attribute.key: attribute.value.string_value for attribute in span.attributes}


def _status_code(span) -> int:
    return next(
        attribute.value.int_value
        for attribute in span.attributes
        if attribute.key == "rpc.grpc.status_code"
    )


async def _serve(wiring, analysis):
    """The production server on an ephemeral port, carrying the interceptor."""
    stop = asyncio.Event()
    server, health_servicer, port = _build(
        0,
        api_key=_BOOT_KEY,
        analysis=analysis,
        max_inflight_requests=8,
        server_interceptor=wiring.server_interceptor,
        observability=wiring.observability,
    )
    serve = asyncio.create_task(
        _serve_until_stopped(server, health_servicer, stop, analysis)
    )
    try:
        yield port
    finally:
        stop.set()
        await serve


async def _probe(port: int) -> None:
    async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        health = health_pb2_grpc.HealthStub(channel)
        await health.Check(health_pb2.HealthCheckRequest(service=""))
        detect = ai_service_pb2_grpc.AIServiceStub(channel).Detect
        await detect(
            pb.DetectRequest(text="a handful of words to analyse"),
            metadata=(("x-api-key", _BOOT_KEY),),
        )


def test_the_wired_build_traces_the_rpc_and_leaves_the_probes_out(
    receiver: str,
) -> None:
    _RECEIVED.clear()
    wiring = build_observability_service(_settings(receiver), "dev")
    analysis = build_analysis(StubEngine(), observability=wiring.observability)

    async def scenario() -> None:
        async for port in _serve(wiring, analysis):
            await _probe(port)

    try:
        asyncio.run(scenario())
    finally:
        # The drain flushes the spans to the receiver.
        wiring.observability.shutdown()

    spans = _spans()
    assert [span.name for span in spans] == ["/inference.v1.AIService/Detect"]
    attributes = _attributes(spans[0])
    assert attributes["model.id"] == "spark"
    assert attributes["model.revision"]
    assert attributes["inference.provider"] == "CPUExecutionProvider"
    assert _status_code(spans[0]) == grpc.StatusCode.OK.value[0]


def test_a_rejected_call_is_traced_as_a_failure(receiver: str) -> None:
    _RECEIVED.clear()
    wiring = build_observability_service(_settings(receiver), "dev")
    analysis = build_analysis(StubEngine(), observability=wiring.observability)

    async def scenario() -> None:
        async for port in _serve(wiring, analysis):
            async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                detect = ai_service_pb2_grpc.AIServiceStub(channel).Detect
                with pytest.raises(aio.AioRpcError):
                    await detect(pb.DetectRequest(text="x"))

    try:
        asyncio.run(scenario())
    finally:
        wiring.observability.shutdown()

    spans = _spans()
    assert [span.name for span in spans] == ["/inference.v1.AIService/Detect"]
    assert _status_code(spans[0]) == grpc.StatusCode.UNAUTHENTICATED.value[0]
    # New Relic reads the span status as the error flag.
    assert spans[0].status.code == 2


def test_the_wired_build_exports_metrics_and_logs(receiver: str) -> None:
    _RECEIVED.clear()
    wiring = build_observability_service(_settings(receiver), "dev")
    analysis = build_analysis(StubEngine(), observability=wiring.observability)

    async def scenario() -> None:
        async for port in _serve(wiring, analysis):
            await _probe(port)

    # main() sets INFO before the boot; the test process does not import it.
    root = logging.getLogger()
    original_level = root.level
    root.setLevel(logging.INFO)
    try:
        asyncio.run(scenario())
    finally:
        root.setLevel(original_level)
        wiring.observability.shutdown()

    assert {
        "inference_queue_depth",
        "inference_batch_size",
        "inference_inflight_chunks",
        "inference_engine_duration_seconds",
    } <= _metric_names()
    assert _log_bodies()


def test_a_disconnected_stream_is_traced_as_cancelled(receiver: str) -> None:
    _RECEIVED.clear()
    wiring = build_observability_service(_settings(receiver), "dev")
    engine = BlockingEngine()
    analysis = build_analysis(engine, observability=wiring.observability)

    async def scenario() -> None:
        async for port in _serve(wiring, analysis):
            async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
                call = ai_service_pb2_grpc.AIServiceStub(channel).AnalyzeDocument(
                    pb.AnalyzeDocumentRequest(text="a handful of words to analyse"),
                    metadata=(("x-api-key", _BOOT_KEY),),
                )
                try:
                    first = await call.read()
                    assert first.WhichOneof("event") == "started"
                    assert await asyncio.to_thread(engine.entered.wait, 5.0)
                    call.cancel()
                finally:
                    engine.release.set()

                with pytest.raises(asyncio.CancelledError):
                    await call.read()

    try:
        asyncio.run(scenario())
    finally:
        wiring.observability.shutdown()

    spans = _spans()
    assert [span.name for span in spans] == ["/inference.v1.AIService/AnalyzeDocument"]
    assert spans[0].status.code == 2
    assert spans[0].status.message == "CANCELLED"
