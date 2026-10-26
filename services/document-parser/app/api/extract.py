"""The authenticated extraction route: transport, admission, then extraction.

The route owns transport-shaped rules and nothing else: the 401 guard
runs first (a body is never read without a key), the bounded read proves
a size breach at limit+1 while abandoning the bulk (NFR-4), starlette's
multipart parser turns the capped body into the single `file` field, and
the strategy registry classifies the raw bytes. An admitted upload runs
the extraction pipeline on the request task (extraction.md sits under the
10-second budget). Its typed failures map onto the wire: the budget's
504 is generic, and everything failing after admission — scanned pdfs,
malformed body XML, a dead decode — shares the generic 422 admission
already answers with. 413 names the bound, 415 names the sniffed MIME
while the declared Content-Type is metadata only, and a malformed
multipart body or a missing `file` field takes the same generic 422
because a corrupt upload cannot be branded (http.md).
"""

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from ..extraction import BudgetExhaustedError, UnreadableDocumentError
from ..validation import CorruptDocumentError, TooLargeError, UnsupportedTypeError
from .auth import api_key_auth

router = APIRouter()

_BUDGET_DETAIL = "the processing budget was exceeded"
_CORRUPT_DETAIL = "corrupt or unsupported upload"
_FILE_FIELD = "file"


@router.post("/api/v1/extract", dependencies=[Depends(api_key_auth)], response_model=None)
async def extract(request: Request) -> dict[str, object]:
    """Bounded read, admission, pipeline; each failure carries its verdict."""
    bound = request.app.state.settings.upload_limit_bytes
    body = await _read_bounded(request, cap=bound)
    if len(body) > bound:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"the request body exceeds the {bound}-byte upload limit",
        )

    document, filename = await _file_part_bytes(request, body, bound)
    try:
        outcome = request.app.state.validation_service.validate(document)
    except UnsupportedTypeError as verdict:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(verdict)
        ) from verdict
    except TooLargeError as verdict:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(verdict)) from verdict
    except CorruptDocumentError as unrecognized:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL
        ) from unrecognized

    try:
        result = request.app.state.extraction_service.extract(document, outcome.mime)
    except BudgetExhaustedError as spent:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=_BUDGET_DETAIL
        ) from spent
    except UnreadableDocumentError as unreadable:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL
        ) from unreadable

    # filename is metadata echoed verbatim (http.md), defaulted when the part
    # carried none; content_type is the sniffed mime, never the declared one.
    return {
        "filename": filename or "unknown",
        "content_type": outcome.mime,
        "text_length": len(result.text),
        "text": result.text,
        "truncated": result.truncated,
    }


async def _read_bounded(request: Request, cap: int) -> bytes:
    """The body read up to cap+1 bytes: the first byte beyond cap proves
    the breach while the rest of the stream is abandoned — the bulk is
    never buffered (http.md).
    """
    buffer = bytearray()
    async for chunk in request.stream():
        buffer += chunk
        if len(buffer) > cap:
            break
    return bytes(buffer)


async def _file_part_bytes(request: Request, body: bytes, bound: int) -> tuple[bytes, str]:
    """The raw bytes and the filename of the single `file` field, parsed
    once from the capped body; malformed multipart and a missing field
    share the generic 422. The filename is metadata, passed through as
    the part carried it (empty included) — the response defaults it."""
    async def _stream() -> AsyncGenerator[bytes, None]:
        yield body

    # starlette indexes the header directly (headers["Content-Type"]), so
    # its absence is a bare KeyError rather than MultiPartException — the
    # generic 422 has to claim it first.
    if request.headers.get("content-type") is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL)

    try:
        parser = MultiPartParser(headers=request.headers, stream=_stream(), max_part_size=bound + 1)
        form = await parser.parse()
    except MultiPartException as error:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL) from error

    upload = form.get(_FILE_FIELD)
    if not isinstance(upload, UploadFile):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL)
    raw = await upload.read()
    await _close_parts(form)
    return raw, upload.filename or ""


async def _close_parts(form: FormData) -> None:
    """Every parsed file part closes its spooled temp file, not just ours."""
    for _name, value in form.multi_items():
        if isinstance(value, UploadFile):
            await value.close()
