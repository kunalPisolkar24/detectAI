from fastapi import APIRouter, Response
from app.core.metrics import render_metrics
from app.models.extraction import HealthCheck

router = APIRouter()

@router.get("/health", response_model=HealthCheck)
async def health_check():
    return HealthCheck(status="ok")

@router.get("/metrics")
async def metrics():
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
