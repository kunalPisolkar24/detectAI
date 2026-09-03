import os
import pytest

def test_tracing_disabled_without_endpoint(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    # Need fresh import to avoid cached provider
    from src.infrastructure.tracing import setup_tracing

    provider = setup_tracing(service_name="test-inference")
    assert provider is None

def test_tracing_enabled_with_endpoint(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318")
    from src.infrastructure.tracing import setup_tracing, shutdown_tracing

    provider = setup_tracing(service_name="test-inference-tracing")
    # Provider may be existing from previous test, but should not be None
    assert provider is not None
    # Shutdown should not raise
    shutdown_tracing(provider)
    shutdown_tracing(None)
    # Cleanup env
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)

def test_tracing_in_memory_exporter(monkeypatch):
    pytest.importorskip("opentelemetry.sdk.trace.export.in_memory_span_exporter")
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry import trace

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test")

    with tracer.start_as_current_span("test-span") as span:
        span.set_attribute("rpc.method", "Detect")
        assert span.get_span_context().is_valid

    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].name == "test-span"
    assert spans[0].attributes.get("rpc.method") == "Detect"
