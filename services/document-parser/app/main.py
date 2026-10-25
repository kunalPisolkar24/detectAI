import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.extract import router as extract_router
from .config import ConfigFactory, Settings, deployment_flick
from .validation import build_default_service

# App-side logs have no handlers until OTel lands (observability.md); INFO keeps
# the startup/shutdown phases and config fallbacks visible meanwhile.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # The composition root: the flick selects the plane, the plane feeds the
    # typed contract. A misconfigured plane or an invalid API key fails the
    # boot here, before serving, per requirements.md.
    flick = deployment_flick()
    provider = ConfigFactory.create(flick)
    settings = Settings.from_provider(provider)
    app.state.settings = settings
    # The composition root builds the registry once, from the same resolved
    # settings the guard reads: strategies carry the boot's numeric bounds.
    app.state.validation_service = build_default_service(
        max_pdf_pages=settings.max_pdf_pages,
        docx_max_uncompressed_bytes=settings.docx_max_uncompressed_bytes,
    )
    logger.info("config plane: %s", flick)

    yield
    # No drain to run: the sync runtime owns no worker pool (extraction.md).
    logger.info("document parser shutdown complete")


app = FastAPI(title="Document Parser", lifespan=lifespan)
app.include_router(extract_router)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/ready")
def ready() -> dict[str, str]:
    return {"status": "ready"}
