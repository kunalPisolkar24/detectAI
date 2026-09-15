import asyncio
import contextvars
import time
from functools import partial

from fastapi import APIRouter, File, Request, UploadFile

from app.api.v1.dependencies import validate_upload
from app.api.v1.schemas.extraction import ExtractionResponse
from app.application.dto import ExtractCommand
from app.application.use_cases.extract_document import run_extraction_task
from app.core.config import settings
from app.domain.exceptions import ExtractionTimeoutError
from app.infrastructure.observability.metrics import record_extraction_timeout

router = APIRouter()


@router.post("/extract", response_model=ExtractionResponse)
async def extract_text(request: Request, file: UploadFile = File(...)):
    mime_type = await validate_upload(file)
    content = await file.read()
    filename = file.filename or "unknown"
    command = ExtractCommand(filename=filename, mime_type=mime_type, content=content)

    loop = asyncio.get_running_loop()
    ctx = contextvars.copy_context()
    pool = getattr(request.app.state, "extraction_pool", getattr(request.app.state, "process_pool", None))
    future = loop.run_in_executor(pool, partial(ctx.run, run_extraction_task, command, time.perf_counter()))

    try:
        result = await asyncio.wait_for(future, timeout=settings.EXTRACTION_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        record_extraction_timeout(mime_type)
        raise ExtractionTimeoutError(settings.EXTRACTION_TIMEOUT_SECONDS)

    return ExtractionResponse.from_domain(filename, mime_type, result)
