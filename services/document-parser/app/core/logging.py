"""Thin re-export — canonical implementation lives in infrastructure.

Kept for backward compat; new code should import from
``app.infrastructure.observability.logging`` directly.
"""

import time

from opentelemetry import trace  # re-export for callers

from app.infrastructure.observability.logging import JsonFormatter, current_trace_id, logger


async def log_request_middleware(request, call_next):  # pragma: no cover - legacy compat
    """Deprecated alias for ``app.api.middleware.request_middleware``."""
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


__all__ = ["JsonFormatter", "current_trace_id", "logger", "trace", "log_request_middleware"]
