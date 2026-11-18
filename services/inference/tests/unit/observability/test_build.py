"""The NFR-5 gate from the factory side: the null build installs nothing,
the wired build returns ready with the server interceptor in hand. The wired
tests post against a module-scoped local receiver so the real OTLP exporters
they construct stay fast, quiet, and network-free."""

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from opentelemetry.sdk.metrics import Histogram
from opentelemetry.sdk.metrics.export import AggregationTemporality

from app.config import Settings
from app.observability import (
    NullObservability,
    ObservabilityService,
    build_observability_service,
)

_FLICK = "dev"  # the boot's plane rides in as the parameter the factory builds from


class _Details:
    """The call details the filter reads: the interceptor passes this shape."""

    def __init__(self, method: str) -> None:
        self.method = method


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
    null_build = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=""), _FLICK
    )

    assert isinstance(null_build.observability, NullObservability)
    # no interceptor: the server carries the plain chain and installs nothing
    assert null_build.server_interceptor is None


def test_the_wired_build_is_ready_and_carries_the_interceptor(receiver: str) -> None:
    wired = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=receiver), _FLICK
    )
    try:
        assert isinstance(wired.observability, ObservabilityService)
        assert wired.server_interceptor is not None
        # one resource feeds every provider; the flick names the environment
        attributes = wired.observability._traces.provider().resource.attributes
        assert attributes["deployment.environment.name"] == "dev"
        assert attributes["service.name"] == "inference"
    finally:
        wired.observability.shutdown()


def test_the_probe_services_are_kept_out_of_the_traffic(receiver: str) -> None:
    wired = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=receiver), _FLICK
    )
    try:
        filter_ = wired.server_interceptor._filter
        assert filter_ is not None
        assert filter_(_Details("/grpc.health.v1.Health/Check")) is False
        assert filter_(_Details("/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo")) is False
        assert filter_(_Details("/inference.v1.AIService/Detect")) is True
    finally:
        wired.observability.shutdown()


def test_the_wired_exporter_declares_delta_temporality(receiver: str) -> None:
    """Delta for the histogrammed instrument is the wire position (the export
    shape the board's percentiles read). The periodic reader defers to the
    exporter's preferred temporality — this pins that linkage where an SDK
    upgrade could silently regenerate CUMULATIVE buckets."""
    wired = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=receiver), _FLICK
    )
    try:
        binding = wired.observability._metrics._metric_exporter._preferred_temporality
        assert binding[Histogram] == AggregationTemporality.DELTA
    finally:
        wired.observability.shutdown()


def test_the_version_falls_back_to_dev_via_the_factory(receiver: str) -> None:
    wired = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=receiver), _FLICK
    )
    try:
        attributes = wired.observability._traces.provider().resource.attributes
        assert attributes["service.version"] == "dev"
    finally:
        wired.observability.shutdown()


def test_an_explicit_version_rides_the_resource(receiver: str) -> None:
    wired = build_observability_service(
        _settings(otel_exporter_otlp_endpoint=receiver, otel_service_version="1.2.3"),
        _FLICK,
    )
    try:
        attributes = wired.observability._traces.provider().resource.attributes
        assert attributes["service.version"] == "1.2.3"
    finally:
        wired.observability.shutdown()
