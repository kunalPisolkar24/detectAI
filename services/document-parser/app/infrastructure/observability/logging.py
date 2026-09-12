import json
import logging
import sys

from opentelemetry import trace


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
        }
        if hasattr(record, "request_meta"):
            payload.update(record.request_meta)
        return json.dumps(payload)


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
