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


def current_trace_id() -> str:
    ctx = trace.get_current_span().get_span_context()
    if ctx and ctx.is_valid:
        return format(ctx.trace_id, "032x")
    return "-"
