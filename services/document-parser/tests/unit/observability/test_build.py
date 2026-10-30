"""The NFR-5 gate from the factory side: the null build installs nothing,
the wired build returns ready with the app instrumented. The wired tests
post against a module-scoped local receiver so the real OTLP exporters
they construct stay fast, quiet, and network-free."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi import FastAPI
from opentelemetry.sdk.metrics import Counter, Histogram
from opentelemetry.sdk.metrics.export import AggregationTemporality

from app.config import Settings
from app.observability import (
    NullObservability,
    ObservabilityService,
    build_observability_service,
)


class _AcceptAnyPost(BaseHTTPRequestHandler):
    """Swallows OTLP payloads whole — the tests watch shapes, not bytes."""

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0") or 0)
        self.rfile.read(length)
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args: object) -> None:
        """Silence the access line; quietness is the fixture's point."""


@pytest.fixture(scope="module")
def receiver() -> str:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _AcceptAnyPost)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def _settings(**overrides: object) -> Settings:
    base = {
        "api_key": "a" * 20,
        "otel_exporter_otlp_endpoint": "http://localhost:4318",
        "new_relic_license_key": "d" * 20,
    }
    return Settings.model_validate({**base, **overrides})


def test_an_endpoint_less_boot_installs_nothing() -> None:
    app = FastAPI()

    null_build = build_observability_service(_settings(otel_exporter_otlp_endpoint=""), app)

    assert isinstance(null_build, NullObservability)
    # the app stays untouched: the disabled build is what the route rides
    assert app.user_middleware == []


def test_the_wired_build_is_ready_and_instruments_the_app(receiver: str) -> None:
    app = FastAPI()

    wired = build_observability_service(_settings(otel_exporter_otlp_endpoint=receiver), app)
    try:
        assert isinstance(wired, ObservabilityService)
        # the instrumentation wraps the middleware-stack builder, explicitly
        assert app._is_instrumented_by_opentelemetry is True
        assert hasattr(app, "_original_build_middleware_stack")
        # Starlette 1.9 builds the stack lazily on the first app call — the
        # factory's own rebuild is what puts the span middleware on the
        # serving path, so the stack must be built, not deferred
        assert app.middleware_stack is not None
        # one resource feeds every provider; the flick names the environment
        attributes = wired._traces.provider().resource.attributes
        assert attributes["deployment.environment.name"] == "dev"
        assert attributes["service.name"] == "document-parser"
    finally:
        wired.shutdown()


def test_the_wired_exporter_declares_delta_temporality(receiver: str) -> None:
    """Delta for counted and histogrammed instruments is the wire position
    (observability.md's export shape). The periodic reader defers to the
    exporter's preferred temporality — this pins that linkage where an SDK
    upgrade could silently regenerate CUMULATIVE counters."""
    wired = build_observability_service(_settings(otel_exporter_otlp_endpoint=receiver), FastAPI())
    try:
        binding = wired._metrics._metric_exporter._preferred_temporality
        assert binding[Counter] == AggregationTemporality.DELTA
        assert binding[Histogram] == AggregationTemporality.DELTA
    finally:
        wired.shutdown()


def test_the_version_falls_back_to_dev_via_the_factory(receiver: str) -> None:
    wired = build_observability_service(_settings(otel_exporter_otlp_endpoint=receiver), FastAPI())
    try:
        attributes = wired._traces.provider().resource.attributes
        assert attributes["service.version"] == "dev"
    finally:
        wired.shutdown()


def test_an_explicit_version_rides_the_resource(receiver: str) -> None:
    wired = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=receiver, otel_service_version="1.2.3"),
        FastAPI(),
    )
    try:
        attributes = wired._traces.provider().resource.attributes
        assert attributes["service.version"] == "1.2.3"
    finally:
        wired.shutdown()
