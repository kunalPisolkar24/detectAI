import logging
import sys
import json
import time

from fastapi import Request
from opentelemetry import trace


class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_obj = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.module,
        }
        if hasattr(record, "request_meta"):
            log_obj.update(record.request_meta)
        return json.dumps(log_obj)

logger = logging.getLogger("file_service")
logger.setLevel(logging.INFO)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
logger.addHandler(handler)


def current_trace_id() -> str:
    context = trace.get_current_span().get_span_context()
    if context and context.is_valid:
        return format(context.trace_id, "032x")
    return "-"

async def log_request_middleware(request: Request, call_next):
    start_time = time.time()
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000

    meta = {
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": round(process_time, 2),
        "trace_id": current_trace_id(),
    }

    logger.info("Request processed", extra={"request_meta": meta})
    return response
