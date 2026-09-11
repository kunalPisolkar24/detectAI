import time

from opentelemetry import trace

from app.infrastructure.observability.logging import JsonFormatter, logger


def current_trace_id() -> str:
    ctx = trace.get_current_span().get_span_context()
    if ctx and ctx.is_valid:
        return format(ctx.trace_id, "032x")
    return "-"


__all__ = ["JsonFormatter", "current_trace_id", "logger", "log_request_middleware", "trace"]


async def log_request_middleware(request, call_next):
    start = time.time()
    response = await call_next(request)
    meta = {
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": round((time.time() - start) * 1000, 2),
        "trace_id": current_trace_id(),
    }
    logger.info("Request processed", extra={"request_meta": meta})
    return response
