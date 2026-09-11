import time

from fastapi import Request

from app.infrastructure.observability.logging import current_trace_id, logger
from app.infrastructure.observability.metrics import IN_FLIGHT_REQUESTS, record_request


async def request_middleware(request: Request, call_next):
    is_metrics = request.url.path == "/api/v1/metrics"
    start = time.perf_counter()
    if not is_metrics:
        IN_FLIGHT_REQUESTS.inc()
    try:
        response = await call_next(request)
    finally:
        if not is_metrics:
            IN_FLIGHT_REQUESTS.dec()
    duration = time.perf_counter() - start
    meta = {
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": round(duration * 1000, 2),
        "trace_id": current_trace_id(),
    }
    logger.info("Request processed", extra={"request_meta": meta})
    if not is_metrics:
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        record_request(request.method, route_path, response.status_code, duration)
    return response
