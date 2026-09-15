from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.infrastructure.executor.extraction_pool import register_extraction_pool
from app.infrastructure.observability.tracing import setup_tracing


@asynccontextmanager
async def lifespan(app: FastAPI):
    _settings = get_settings()
    pool = ThreadPoolExecutor(max_workers=_settings.WORKER_THREADS)
    app.state.extraction_pool = pool
    app.state.process_pool = pool  # legacy alias
    register_extraction_pool(pool)
    setup_tracing(
        app,
        service_name=_settings.OTEL_SERVICE_NAME,
        service_version=_settings.OTEL_SERVICE_VERSION,
    )
    yield
    pool.shutdown(wait=True)
