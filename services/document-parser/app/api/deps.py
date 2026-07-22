import magic
from fastapi import UploadFile
from app.core.config import settings
from app.core.exceptions import UnsupportedFileTypeError, FileTooLargeError


async def validate_upload(file: UploadFile) -> str:
    if file.size and file.size > settings.MAX_UPLOAD_SIZE_BYTES:
        raise FileTooLargeError(file.size, settings.MAX_UPLOAD_SIZE_BYTES)

    await file.seek(0)
    raw = await file.read(4096)
    await file.seek(0)

    mime_type = magic.from_buffer(raw, mime=True)

    if mime_type not in settings.ALLOWED_MIME_TYPES:
        raise UnsupportedFileTypeError(mime_type)

    return mime_type
