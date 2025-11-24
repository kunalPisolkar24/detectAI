import asyncio
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File, HTTPException
from app.config import settings
from app.utils.logger import logger, log_request_middleware
from app.utils.validator import validate_file
from app.utils.cleaner import TextCleaner
from app.services.extractor import FileExtractor
from app.schemas import ExtractionResponse, HealthCheck
from starlette.middleware.base import BaseHTTPMiddleware

app = FastAPI(title=settings.API_TITLE, version=settings.API_VERSION)

app.add_middleware(BaseHTTPMiddleware, dispatch=log_request_middleware)

# Thread pool for CPU-bound tasks
process_pool = ThreadPoolExecutor(max_workers=4)

def cpu_bound_processing(file_obj: UploadFile, content: bytes) -> str:
    raw_text = FileExtractor.process(file_obj, content)
    clean_text = TextCleaner.clean(raw_text)
    return clean_text

@app.post("/extract", response_model=ExtractionResponse)
async def extract_text(file: UploadFile = File(...)):
    logger.info(f"Received file: {file.filename}, type: {file.content_type}")
    
    try:
        await validate_file(file)
        
        content = await file.read()
        
        loop = asyncio.get_running_loop()
        extracted_text = await loop.run_in_executor(
            process_pool, 
            cpu_bound_processing, 
            file, 
            content
        )
        
        return ExtractionResponse(
            filename=file.filename,
            content_type=file.content_type,
            text_length=len(extracted_text),
            text=extracted_text
        )

    except HTTPException as he:
        raise he
    except ValueError as ve:
        logger.error(f"Processing error: {str(ve)}")
        raise HTTPException(status_code=422, detail=str(ve))
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal processing error")

@app.get("/health", response_model=HealthCheck)
async def health_check():
    return HealthCheck(status="ok")