from fastapi import Request
from starlette.responses import JSONResponse
from app.core.exceptions import DocumentParserError

async def document_parser_exception_handler(request: Request, exc: DocumentParserError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message}
    )
