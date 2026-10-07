from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import get_settings
from app.infrastructure.executor.extraction_pool import register_extraction_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    _settings = get_settings()
    pool = ThreadPoolExecutor(max_workers=_settings.WORKER_THREADS)
    app.state.extraction_pool = pool
    app.state.process_pool = pool  # legacy alias
    register_extraction_pool(pool)
    yield
    pool.shutdown(wait=True)
