from fastapi import Request
from starlette.responses import JSONResponse
from app.core.exceptions import DocumentParserError, ExtractionError
from app.core.logging import logger
from app.core.metrics import record_rejected_upload

GENERIC_EXTRACTION_DETAIL = "Could not extract text from this document."

async def document_parser_exception_handler(request: Request, exc: DocumentParserError):
    record_rejected_upload(exc)

    if isinstance(exc, ExtractionError):
        logger.error(
            "Extraction failed",
            extra={"request_meta": {"path": request.url.path, "detail": exc.message}},
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": GENERIC_EXTRACTION_DETAIL}
        )

    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message}
    )
