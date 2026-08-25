from fastapi import APIRouter, Response
from app.core.metrics import is_process_pool_healthy, render_metrics
from app.models.extraction import HealthCheck

router = APIRouter()

@router.get("/health", response_model=HealthCheck)
async def health_check():
    if not is_process_pool_healthy():
        return Response(
            content=HealthCheck(status="unavailable").model_dump_json(),
            media_type="application/json",
            status_code=503,
        )
    return HealthCheck(status="ok")

@router.get("/ready", response_model=HealthCheck)
async def readiness_check():
    if not is_process_pool_healthy():
        return Response(
            content=HealthCheck(status="not_ready").model_dump_json(),
            media_type="application/json",
            status_code=503,
        )
    return HealthCheck(status="ready")

@router.get("/metrics")
async def metrics():
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
