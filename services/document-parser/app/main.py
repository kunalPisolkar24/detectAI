import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.extract import router as extract_router
from .config import ConfigFactory, Settings, deployment_flick

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
    app.state.settings = Settings.from_provider(provider)
    logger.info("config plane: %s", flick)

    yield
    # NFR-9: the extract task adds its bounded worker-pool drain here.
    logger.info("document parser shutdown complete")


app = FastAPI(title="Document Parser", lifespan=lifespan)
app.include_router(extract_router)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/ready")
def ready() -> dict[str, str]:
    return {"status": "ready"}
