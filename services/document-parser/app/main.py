import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import Settings

# App-side logs have no handlers until OTel lands (observability.md); INFO keeps
# the startup/shutdown phases and config fallbacks visible meanwhile.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Fails the boot on an invalid API key, per requirements.md.
    app.state.settings = Settings()
    yield
    # NFR-9: the extract task adds its bounded worker-pool drain here.
    logger.info("document parser shutdown complete")


app = FastAPI(title="Document Parser", lifespan=lifespan)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/ready")
def ready() -> dict[str, str]:
    return {"status": "ready"}
