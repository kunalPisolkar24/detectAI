import asyncio
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, UploadFile, File, Request, Response, Depends
from app.config import settings
from app.utils.logger import logger, log_request_middleware
from app.utils.validator import validate_file
from app.services.orchestrator import ExtractionOrchestrator
from app.schemas import ExtractionResponse, HealthCheck
from app.metrics import record_request, render_metrics
from app.exceptions import DocumentParserError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.process_pool = ThreadPoolExecutor(
        max_workers=settings.WORKER_THREADS
    )
    yield
    app.state.process_pool.shutdown(wait=True)

app = FastAPI(
    title=settings.API_TITLE, 
    version=settings.API_VERSION,
    lifespan=lifespan
)

app.add_middleware(BaseHTTPMiddleware, dispatch=log_request_middleware)

@app.exception_handler(DocumentParserError)
async def document_parser_exception_handler(request: Request, exc: DocumentParserError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message}
    )

async def metrics_middleware(request: Request, call_next):
    if request.url.path == "/metrics":
        return await call_next(request)
    
    import time
    start = time.perf_counter()
    response = await call_next(request)
    
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    record_request(request.method, route_path, response.status_code, time.perf_counter() - start)
    return response

app.add_middleware(BaseHTTPMiddleware, dispatch=metrics_middleware)

@app.post("/extract", response_model=ExtractionResponse)
async def extract_text(request: Request, file: UploadFile = File(...)):
    await validate_file(file)
    
    loop = asyncio.get_running_loop()
    extracted_text = await loop.run_in_executor(
        request.app.state.process_pool,
        ExtractionOrchestrator.process_file,
        file
    )
    
    return ExtractionResponse(
        filename=file.filename or "unknown",
        content_type=file.content_type or "unknown",
        text_length=len(extracted_text),
        text=extracted_text
    )

@app.get("/health", response_model=HealthCheck)
async def health_check():
    return HealthCheck(status="ok")

@app.get("/metrics")
async def metrics():
    payload, content_type = render_metrics()
    return Response(content=payload, media_type=content_type)
