import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_tracing(
    app,
    service_name: str | None = None,
    service_version: str | None = None,
    endpoint: str | None = None,
) -> None:
    """Configure OTel tracing if an endpoint is provided.

    Precedence: explicit ``endpoint`` arg > ``OTEL_EXPORTER_OTLP_ENDPOINT`` env
    > ``Settings.OTEL_EXPORTER_OTLP_ENDPOINT``. This keeps compose/dev simple
    while allowing DI via ``Settings`` in lifespan.
    """
    if endpoint is None:
        # Prefer env (highest), fall back to Settings via lazy import to avoid cycles
        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        if not endpoint:
            try:
                from app.core.config import get_settings

                endpoint = get_settings().OTEL_EXPORTER_OTLP_ENDPOINT
            except Exception:
                endpoint = None
    if not endpoint:
        return
    if service_name is None or service_version is None:
        try:
            from app.core.config import get_settings

            _s = get_settings()
            service_name = service_name or _s.OTEL_SERVICE_NAME
            service_version = service_version or _s.OTEL_SERVICE_VERSION
        except Exception:
            service_name = service_name or "document-parser"
            service_version = service_version or "1.0.0"
    resource = Resource.create({"service.name": service_name, "service.version": service_version})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint.rstrip("/") + "/v1/traces")))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
