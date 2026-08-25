from fastapi import APIRouter, Response
from app.core.config import settings
from app.core.metrics import get_pool_stats, is_process_pool_healthy, render_metrics
from app.models.extraction import HealthCheck

router = APIRouter()

@router.get("/health", response_model=HealthCheck)
async def health_check():
    if not is_process_pool_healthy():
        return _status_response("unavailable", 503)
    return HealthCheck(status="ok")

@router.get("/ready", response_model=HealthCheck)
async def readiness_check():
    if not is_process_pool_healthy():
        return _status_response("not_ready", 503)

    stats = get_pool_stats()
    if stats is None:
        return _status_response("not_ready", 503)

    busy, queued, max_workers = stats
    if busy >= max_workers or queued >= settings.READINESS_MAX_QUEUE_DEPTH:
        return _status_response("not_ready", 503)

    return HealthCheck(status="ready")


def _status_response(status: str, status_code: int) -> Response:
    return Response(
        content=HealthCheck(status=status).model_dump_json(),
        media_type="application/json",
        status_code=status_code,
    )

@router.get("/metrics")
async def metrics():
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
