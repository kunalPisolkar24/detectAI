from fastapi import UploadFile
from app.core.config import settings
from app.core.exceptions import UnsupportedFileTypeError, FileTooLargeError, ExtractionError

MAGIC_NUMBERS = {
    "application/pdf": b"%PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": b"PK\x03\x04",
}

async def validate_upload(file: UploadFile) -> None:
    if file.size and file.size > settings.MAX_UPLOAD_SIZE_BYTES:
        raise FileTooLargeError(file.size, settings.MAX_UPLOAD_SIZE_BYTES)

    if file.content_type not in settings.ALLOWED_MIME_TYPES:
        raise UnsupportedFileTypeError(file.content_type or "unknown")

    if file.content_type in MAGIC_NUMBERS:
        await file.seek(0)
        header = await file.read(4)
        await file.seek(0)

        if not header.startswith(MAGIC_NUMBERS[file.content_type]):
            raise ExtractionError(f"Invalid file signature for {file.content_type}")
