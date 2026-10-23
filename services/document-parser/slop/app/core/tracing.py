"""Tracing setup — kept in sync with infrastructure implementation for test compat.

Canonical logic lives in ``app.infrastructure.observability.tracing``; this
module mirrors it so ``patch("app.core.tracing.*")`` in unit tests still
applies. New code should import from ``app.infrastructure.observability.tracing``.
"""

import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def _parse_resource_attributes() -> dict[str, str]:
    raw = os.getenv("OTEL_RESOURCE_ATTRIBUTES", "")
    attrs: dict[str, str] = {}
    for part in raw.split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, value = part.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            attrs[key] = value
    return attrs


def _deployment_environment(fallback: str = "prod") -> str:
    attrs = _parse_resource_attributes()
    if attrs.get("deployment.environment"):
        return attrs["deployment.environment"]
    for key in ("DEPLOYMENT_ENV", "ENV_TYPE"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return fallback


def setup_tracing(
    app,
    service_name: str | None = None,
    service_version: str | None = None,
    endpoint: str | None = None,
) -> None:
    if endpoint is None:
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
    resource_attrs: dict[str, str] = {
        "service.name": service_name or "document-parser",
        "service.version": service_version or "1.0.0",
        "deployment.environment": _deployment_environment(),
    }
    resource_attrs.update(_parse_resource_attributes())
    if service_name:
        resource_attrs["service.name"] = service_name
    if service_version:
        resource_attrs["service.version"] = service_version
    resource = Resource.create(resource_attrs)
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint.rstrip("/") + "/v1/traces")))
    try:
        trace.set_tracer_provider(provider)
    except Exception:
        pass
    FastAPIInstrumentor.instrument_app(app)


__all__ = [
    "setup_tracing",
    "trace",
    "OTLPSpanExporter",
    "FastAPIInstrumentor",
    "Resource",
    "TracerProvider",
    "BatchSpanProcessor",
]
