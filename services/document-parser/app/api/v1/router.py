from fastapi import APIRouter
from app.api.v1.endpoints import extract, health

router = APIRouter()
router.include_router(extract.router, tags=["extraction"])
router.include_router(health.router, tags=["system"])
