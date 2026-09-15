from unittest.mock import MagicMock, patch

from app.core.logging import current_trace_id
from app.core.tracing import setup_tracing


def test_setup_tracing_is_noop_without_endpoint(monkeypatch):
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    app = MagicMock()

    with patch("app.core.tracing.FastAPIInstrumentor.instrument_app") as mock_instrument:
        setup_tracing(app, service_name="document-parser", service_version="1.0.0")

    mock_instrument.assert_not_called()


def test_setup_tracing_instruments_and_exports_when_configured(monkeypatch):
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318/")
    app = MagicMock()

    with patch("app.core.tracing.FastAPIInstrumentor.instrument_app") as mock_instrument, \
            patch("app.core.tracing.OTLPSpanExporter") as mock_exporter, \
            patch("app.core.tracing.trace.set_tracer_provider") as mock_set_provider:
        setup_tracing(app, service_name="document-parser", service_version="1.2.3")

    mock_instrument.assert_called_once_with(app)
    mock_exporter.assert_called_once_with(endpoint="http://otel-collector:4318/v1/traces")
    mock_set_provider.assert_called_once()


def test_current_trace_id_returns_placeholder_without_valid_span():
    assert current_trace_id() == "-"


def test_current_trace_id_formats_valid_span_context():
    mock_context = MagicMock()
    mock_context.is_valid = True
    mock_context.trace_id = 0x1234
    mock_span = MagicMock()
    mock_span.get_span_context.return_value = mock_context

    with patch("app.core.logging.trace.get_current_span", return_value=mock_span):
        assert current_trace_id() == "0" * 28 + "1234"
