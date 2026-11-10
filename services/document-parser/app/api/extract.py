"""The authenticated extraction route."""

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request, status
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from ..processing import (
    BudgetExhaustedError,
    CorruptDocumentError,
    TooLargeError,
    UnreadableDocumentError,
    UnsupportedTypeError,
)
from .auth import api_key_auth

router = APIRouter()

_BUDGET_DETAIL = "the processing budget was exceeded"
_CORRUPT_DETAIL = "corrupt or unsupported upload"
_FILE_FIELD = "file"


@router.post("/api/v1/extract", dependencies=[Depends(api_key_auth)], response_model=None)
async def extract(request: Request) -> dict[str, object]:
    """Bounded read and multipart parse; the pipeline's typed verdicts map onto HTTP."""
    observability = request.app.state.observability
    with observability.track_request():
        bound = request.app.state.settings.upload_limit_bytes
        body = await _read_bounded(request, cap=bound)
        if len(body) > bound:
            observability.record_rejection("too_large")
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"the request body exceeds the {bound}-byte upload limit",
            )

        document, filename = await _file_part_bytes(request, body, bound)
        try:
            outcome = request.app.state.document_processing_service.process(document)
        except UnsupportedTypeError as verdict:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=str(verdict)
            ) from verdict
        except TooLargeError as verdict:
            raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(verdict)) from verdict
        except CorruptDocumentError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL
            )
        except BudgetExhaustedError:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=_BUDGET_DETAIL
            )
        except UnreadableDocumentError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL
            )

        # content_type is always the sniffed MIME; the filename is echoed
        # metadata, defaulted when the part carried none.
        return {
            "filename": filename or "unknown",
            "content_type": outcome.mime,
            "text_length": len(outcome.text),
            "text": outcome.text,
            "truncated": outcome.truncated,
        }


async def _read_bounded(request: Request, cap: int) -> bytes:
    """Reads cap+1 bytes: one past the bound proves the breach, the rest is abandoned."""
    buffer = bytearray()
    async for chunk in request.stream():
        buffer += chunk
        if len(buffer) > cap:
            break
    return bytes(buffer)


async def _file_part_bytes(request: Request, body: bytes, bound: int) -> tuple[bytes, str]:
    """Single `file` field, parsed once from the capped body; malformed and missing share the generic 422."""
    async def _stream() -> AsyncGenerator[bytes, None]:
        yield body

    # Starlette raises a bare KeyError on a missing Content-Type, not MultiPartException.
    if request.headers.get("content-type") is None:
        request.app.state.observability.record_rejection("malformed")
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL)

    try:
        parser = MultiPartParser(headers=request.headers, stream=_stream(), max_part_size=bound + 1)
        form = await parser.parse()
    except MultiPartException as error:
        request.app.state.observability.record_rejection("malformed")
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL) from error

    upload = form.get(_FILE_FIELD)
    if not isinstance(upload, UploadFile):
        request.app.state.observability.record_rejection("malformed")
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=_CORRUPT_DETAIL)
    raw = await upload.read()
    await _close_parts(form)
    return raw, upload.filename or ""


async def _close_parts(form: FormData) -> None:
    for _name, value in form.multi_items():
        if isinstance(value, UploadFile):
            await value.close()
