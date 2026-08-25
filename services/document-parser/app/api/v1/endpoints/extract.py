import asyncio
import time
from fastapi import APIRouter, File, Request, UploadFile
from app.api.deps import validate_upload
from app.core.config import settings
from app.core.exceptions import ExtractionTimeoutError
from app.core.metrics import record_extraction_timeout
from app.domain.extraction.service import run_extraction_task
from app.models.extraction import ExtractionResponse

router = APIRouter()

@router.post("/extract", response_model=ExtractionResponse)
async def extract_text(request: Request, file: UploadFile = File(...)):
    mime_type = await validate_upload(file)

    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(
        request.app.state.process_pool,
        run_extraction_task,
        file,
        mime_type,
        time.perf_counter(),
    )

    try:
        result = await asyncio.wait_for(future, timeout=settings.EXTRACTION_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        record_extraction_timeout(mime_type)
        raise ExtractionTimeoutError(settings.EXTRACTION_TIMEOUT_SECONDS)

    return ExtractionResponse(
        filename=file.filename or "unknown",
        content_type=mime_type,
        text_length=len(result.text),
        text=result.text,
        truncated=result.truncated
    )
