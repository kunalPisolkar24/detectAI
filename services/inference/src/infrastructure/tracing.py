import os

import structlog

logger = structlog.get_logger()


def setup_tracing(service_name: str | None = None, service_version: str | None = None):
    """Setup OpenTelemetry tracing for gRPC server.

    Export is OTLP/HTTP to OTEL_EXPORTER_OTLP_ENDPOINT (e.g. http://otel-collector:4318).
    Fail-open if no endpoint or deps missing, matching document-parser and workers.
    """
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint:
        logger.info("tracing_disabled_no_endpoint")
        return None

    try:
        from opentelemetry import trace, propagate
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.propagate import set_global_textmap
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

        try:
            from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer

            _grpc_instrumentor = GrpcAioInstrumentorServer
        except ImportError:
            try:
                from opentelemetry.instrumentation.grpc import GrpcAioServerInstrumentor

                _grpc_instrumentor = GrpcAioServerInstrumentor  # type: ignore[no-redef]
            except ImportError:
                _grpc_instrumentor = None  # type: ignore[assignment]

        # Avoid double-setup in tests (TracerProvider can only be set once)
        try:
            from opentelemetry.sdk.trace import TracerProvider as SdkTracerProvider

            existing = trace.get_tracer_provider()
            if isinstance(existing, SdkTracerProvider):
                logger.info("tracing_already_setup")
                return existing
        except Exception:
            pass

        resolved_name = service_name or os.getenv("OTEL_SERVICE_NAME", "inference")
        resolved_version = service_version or os.getenv("OTEL_SERVICE_VERSION") or os.getenv("SERVICE_VERSION", "0.1.0")

        resource = Resource.create(
            {
                "service.name": resolved_name,
                "service.version": resolved_version,
            }
        )
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=endpoint.rstrip("/") + "/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        try:
            trace.set_tracer_provider(provider)
        except Exception as e:
            logger.warning("tracing_provider_override_failed", error=str(e))
        try:
            set_global_textmap(TraceContextTextMapPropagator())
        except Exception:
            pass
        # Auto-instrument gRPC server if available
        if _grpc_instrumentor is not None:
            try:
                _grpc_instrumentor().instrument()
            except Exception as e:
                logger.warning("grpc_tracing_instrumentation_failed", error=str(e))

        logger.info("tracing_enabled", endpoint=endpoint, service_name=resolved_name)
        return provider
    except ImportError as e:
        logger.warning("tracing_disabled_missing_deps", error=str(e))
        return None
    except Exception as e:
        logger.warning("tracing_setup_failed", error=str(e), exc_info=True)
        return None


def shutdown_tracing(provider=None, timeout: float = 5.0) -> None:
    """Flush and shutdown tracing provider. Safe to call even if setup failed."""
    if provider is None:
        try:
            from opentelemetry import trace

            provider = trace.get_tracer_provider()
        except Exception:
            return
    try:
        # BatchSpanProcessor shutdown with timeout
        if hasattr(provider, "shutdown"):
            provider.shutdown()
        elif hasattr(provider, "force_flush"):
            provider.force_flush(timeout_millis=int(timeout * 1000))
    except Exception as e:
        logger.warning("tracing_shutdown_failed", error=str(e))
