import time
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from app.core.exceptions import DocumentParserError
from app.core.logging import current_trace_id, logger
from app.core.metrics import IN_FLIGHT_REQUESTS, record_request, register_process_pool
from app.api.v1.router import router as v1_router
from app.api.exception_handlers import document_parser_exception_handler
from app.core.tracing import setup_tracing

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.process_pool = ThreadPoolExecutor(max_workers=settings.WORKER_THREADS)
    register_process_pool(app.state.process_pool)
    setup_tracing(app, service_name="document-parser", service_version=settings.API_VERSION)
    yield
    app.state.process_pool.shutdown(wait=True)

app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    lifespan=lifespan
)

app.exception_handler(DocumentParserError)(document_parser_exception_handler)


async def _combined_middleware(request: Request, call_next):
    is_metrics = request.url.path == "/metrics"
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


app.add_middleware(BaseHTTPMiddleware, dispatch=_combined_middleware)

app.include_router(v1_router)
