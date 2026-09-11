from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.infrastructure.executor.extraction_pool import register_extraction_pool
from app.infrastructure.observability.tracing import setup_tracing


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = ThreadPoolExecutor(max_workers=settings.WORKER_THREADS)
    app.state.extraction_pool = pool
    app.state.process_pool = pool  # legacy alias
    register_extraction_pool(pool)
    setup_tracing(app, service_name="document-parser", service_version=settings.API_VERSION)
    yield
    pool.shutdown(wait=True)
