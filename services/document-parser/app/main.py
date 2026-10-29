import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api.extract import router as extract_router
from .config import ConfigFactory, Settings, deployment_flick
from .extraction import CleaningKnobs, build_default_extraction_service
from .observability import build_observability_service
from .validation import build_default_service

# Stdout is the baseline destination; a wired build adds its OTel ride-along.
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # Fail the boot before serving: a bad plane or key dies here.
    flick = deployment_flick()
    provider = ConfigFactory.create(flick)
    settings = Settings.from_provider(provider)
    app.state.settings = settings
    app.state.validation_service = build_default_service(
        max_pdf_pages=settings.max_pdf_pages,
        docx_max_uncompressed_bytes=settings.docx_max_uncompressed_bytes,
    )
    app.state.extraction_service = build_default_extraction_service(
        processing_budget_seconds=settings.processing_budget_seconds,
        output_char_limit=settings.output_char_limit,
        cleaning_knobs=CleaningKnobs(
            header_repetition_ratio=settings.header_repetition_ratio,
            repetition_min_pages=settings.repetition_min_pages,
            header_edge_zone_ratio=settings.header_edge_zone_ratio,
            edge_zone_ratio=settings.edge_zone_ratio,
            edge_tolerance_ratio=settings.edge_tolerance_ratio,
            folio_monotonic_ratio=settings.folio_monotonic_ratio,
        ),
    )
    # The gate flips on the endpoint: unset installs nothing, set wires the OTel ride-along.
    app.state.observability = build_observability_service(settings, app)
    logger.info("config plane: %s", flick)
    logger.info("observability: %s", type(app.state.observability).__name__)

    yield
    # The sync runtime owns no worker pool; the final log is queued before the
    # drain so it rides the flush out with the rest.
    logger.info("document parser shutdown complete")
    app.state.observability.shutdown()


app = FastAPI(title="Document Parser", lifespan=lifespan)
app.include_router(extract_router)


@app.get("/api/v1/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/ready")
def ready() -> dict[str, str]:
    return {"status": "ready"}
