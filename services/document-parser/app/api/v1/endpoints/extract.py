import asyncio
from fastapi import APIRouter, File, Request, UploadFile
from app.api.deps import validate_upload
from app.domain.extraction.service import ExtractionService
from app.models.extraction import ExtractionResponse

router = APIRouter()

@router.post("/extract", response_model=ExtractionResponse)
async def extract_text(request: Request, file: UploadFile = File(...)):
    await validate_upload(file)

    loop = asyncio.get_running_loop()
    extracted_text = await loop.run_in_executor(
        request.app.state.process_pool,
        ExtractionService.process_file,
        file
    )

    return ExtractionResponse(
        filename=file.filename or "unknown",
        content_type=file.content_type or "unknown",
        text_length=len(extracted_text),
        text=extracted_text
    )
