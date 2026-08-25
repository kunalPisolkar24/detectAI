import time
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from app.core.exceptions import DocumentParserError
from app.core.logging import log_request_middleware
from app.core.metrics import IN_FLIGHT_REQUESTS, record_request
from app.api.v1.router import router as v1_router
from app.api.exception_handlers import document_parser_exception_handler

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.process_pool = ThreadPoolExecutor(max_workers=settings.WORKER_THREADS)
    yield
    app.state.process_pool.shutdown(wait=True)

app = FastAPI(
    title=settings.API_TITLE,
    version=settings.API_VERSION,
    lifespan=lifespan
)

app.add_middleware(BaseHTTPMiddleware, dispatch=log_request_middleware)

@app.exception_handler(DocumentParserError)
async def _document_parser_exception_handler(request: Request, exc: DocumentParserError):
    return await document_parser_exception_handler(request, exc)

async def _metrics_middleware(request: Request, call_next):
    if request.url.path == "/metrics":
        return await call_next(request)

    start = time.perf_counter()
    IN_FLIGHT_REQUESTS.inc()
    try:
        response = await call_next(request)
    finally:
        IN_FLIGHT_REQUESTS.dec()

    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    record_request(request.method, route_path, response.status_code, time.perf_counter() - start)
    return response

app.add_middleware(BaseHTTPMiddleware, dispatch=_metrics_middleware)

app.include_router(v1_router)
