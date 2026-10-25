"""The authenticated extraction route: transport over the admission gate.

The route owns transport-shaped rules and nothing else: the 401 guard
runs first (a body is never read without a key), the bounded read proves
a size breach at limit+1 while abandoning the bulk (NFR-4), starlette's
multipart parser turns the capped body into the single `file` field, and
the strategy registry classifies the raw bytes. A validated upload still
answers 501 — the honest interim per http.md until the extract pipeline
lands. 413 names the limit, 415 names the sniffed MIME, and a malformed
body or a missing `file` field shares the generic 422 because a corrupt
upload cannot be branded (http.md).
"""

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from ..validation import UnsupportedTypeError, build_default_service
from .auth import api_key_auth

router = APIRouter()

_INTERIM_DETAIL = "extraction pipeline not implemented yet"
_CORRUPT_DETAIL = "corrupt or unsupported upload"
_FILE_FIELD = "file"

_validation_service = build_default_service()


@router.post("/api/v1/extract", dependencies=[Depends(api_key_auth)], response_model=None)
async def extract(request: Request) -> None:
    """The validation boundary; the 200 body arrives with the extract chunk."""
    bound = request.app.state.settings.upload_limit_bytes
    body = await _read_bounded(request, cap=bound)
    if len(body) > bound:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"the request body exceeds the {bound}-byte upload limit",
        )

    document = await _file_part_bytes(request, body, bound)
    try:
        _validation_service.validate(document)
    except UnsupportedTypeError as verdict:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(verdict)
        ) from verdict

    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=_INTERIM_DETAIL)


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


async def _file_part_bytes(request: Request, body: bytes, bound: int) -> bytes:
    """The raw bytes of the single `file` field, parsed once from the
    capped body; malformed multipart and a missing field share the
    generic 422."""
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
    return raw


async def _close_parts(form: FormData) -> None:
    """Every parsed file part closes its spooled temp file, not just ours."""
    for _name, value in form.multi_items():
        if isinstance(value, UploadFile):
            await value.close()
