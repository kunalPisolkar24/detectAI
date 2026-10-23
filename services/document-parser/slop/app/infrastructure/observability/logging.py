import json
import logging
import os
import sys

from opentelemetry import trace

_STANDARD_ATTRS = frozenset(
    {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "taskName",
        "request_meta",
        "message",
    }
)


def _service_name() -> str:
    return os.getenv("OTEL_SERVICE_NAME", "document-parser").strip() or "document-parser"


def _deployment_environment() -> str:
    raw = os.getenv("OTEL_RESOURCE_ATTRIBUTES", "")
    for part in raw.split(","):
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, value = part.partition("=")
        if key.strip() == "deployment.environment" and value.strip():
            return value.strip().strip('"').strip("'")
    for key in ("DEPLOYMENT_ENV", "ENV_TYPE"):
        value = os.getenv(key, "").strip()
        if value:
            return value
    return "dev"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ctx = trace.get_current_span().get_span_context()
        trace_id = format(ctx.trace_id, "032x") if ctx and ctx.is_valid else "-"
        span_id = format(ctx.span_id, "016x") if ctx and ctx.is_valid else "-"
        payload = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "severity": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
            "logger": record.name,
            "service.name": _service_name(),
            "deployment.environment": _deployment_environment(),
            "trace_id": trace_id,
            "span_id": span_id,
        }
        if hasattr(record, "request_meta") and isinstance(record.request_meta, dict):
            payload.update(record.request_meta)
            if "trace_id" not in record.request_meta:
                payload["trace_id"] = trace_id
        for key, value in record.__dict__.items():
            if key in _STANDARD_ATTRS or key in payload:
                continue
            try:
                json.dumps(value)
            except Exception:
                continue
            payload[key] = value
        return json.dumps(payload, default=str)


logger = logging.getLogger("file_service")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
if not logger.handlers:
    logger.addHandler(handler)

# alias for new name
document_parser_logger = logging.getLogger("document_parser")
document_parser_logger.handlers = logger.handlers
document_parser_logger.setLevel(logging.INFO)
document_parser_logger.propagate = True

_LEVEL_MAP = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "WARN": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}


def configure_logging(level: str) -> None:
    """Set log level for document-parser loggers from Settings.LOG_LEVEL."""
    lvl = _LEVEL_MAP.get(level.upper().strip(), logging.INFO)
    logger.setLevel(lvl)
    document_parser_logger.setLevel(lvl)


def current_trace_id() -> str:
    ctx = trace.get_current_span().get_span_context()
    if ctx and ctx.is_valid:
        return format(ctx.trace_id, "032x")
    return "-"


def current_span_id() -> str:
    ctx = trace.get_current_span().get_span_context()
    if ctx and ctx.is_valid:
        return format(ctx.span_id, "016x")
    return "-"


_OTLP_LOG_SETUP_DONE = False


def setup_log_export(
    endpoint: str | None = None,
    service_name: str | None = None,
    service_version: str | None = None,
):
    """Forward stdlib logs to the OTEL collector over OTLP/HTTP (fail-open).

    Same endpoint precedence as tracing. No-op when no endpoint is set or
    when the OTLP log packages are unavailable. Safe to call repeatedly
    (handler is attached once per process).
    """
    global _OTLP_LOG_SETUP_DONE
    if _OTLP_LOG_SETUP_DONE:
        return None
    if endpoint is None:
        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
        if not endpoint:
            try:
                from app.core.config import get_settings

                endpoint = get_settings().OTEL_EXPORTER_OTLP_ENDPOINT
            except Exception:
                endpoint = None
    if not endpoint:
        return None
    try:
        from opentelemetry import _logs as logs_api
        from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
        from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
        from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
        from opentelemetry.sdk.resources import Resource
    except Exception:
        return None
    try:
        name = service_name or os.getenv("OTEL_SERVICE_NAME", "document-parser")
        version = service_version or os.getenv("OTEL_SERVICE_VERSION", "1.0.0")
        resource = Resource.create(
            {
                "service.name": name,
                "service.version": version,
                "deployment.environment": _deployment_environment(),
            }
        )
        provider = LoggerProvider(resource=resource)
        provider.add_log_record_processor(
            BatchLogRecordProcessor(OTLPLogExporter(endpoint=endpoint.rstrip("/") + "/v1/logs"))
        )
        try:
            logs_api.set_logger_provider(provider)
        except Exception:
            pass
        otlp_handler = LoggingHandler(level=logging.NOTSET, logger_provider=provider)
        if otlp_handler not in logger.handlers:
            logger.addHandler(otlp_handler)
        if document_parser_logger is not logger and otlp_handler not in document_parser_logger.handlers:
            document_parser_logger.addHandler(otlp_handler)
        _OTLP_LOG_SETUP_DONE = True
        return provider
    except Exception:
        return None
