from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.exception_handlers import document_parser_exception_handler
from app.api.middleware import request_middleware
from app.api.v1.router import router as v1_router
from app.core.config import settings
from app.core.lifespan import lifespan
from app.domain.exceptions import DocumentParserError


def create_app() -> FastAPI:
    app = FastAPI(title=settings.API_TITLE, version=settings.API_VERSION, lifespan=lifespan)
    app.exception_handler(DocumentParserError)(document_parser_exception_handler)
    app.add_middleware(BaseHTTPMiddleware, dispatch=request_middleware)
    app.include_router(v1_router, prefix="/api/v1")
    return app
