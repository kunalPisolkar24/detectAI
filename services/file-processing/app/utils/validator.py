from fastapi import UploadFile, HTTPException
from app.config import settings

MAGIC_NUMBERS = {
    "pdf": b"%PDF",
    "docx": b"PK\x03\x04",
}

async def validate_file(file: UploadFile) -> None:
    if file.size > settings.MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413, 
            detail=f"File size exceeds limit of {settings.MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB"
        )

    if file.content_type not in settings.ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=415, 
            detail=f"Unsupported media type: {file.content_type}"
        )

    await file.seek(0)
    header = await file.read(4)
    await file.seek(0)

    if file.content_type == "application/pdf":
        if not header.startswith(MAGIC_NUMBERS["pdf"]):
            raise HTTPException(status_code=400, detail="Invalid PDF file signature")
            
    elif file.content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        if not header.startswith(MAGIC_NUMBERS["docx"]):
            raise HTTPException(status_code=400, detail="Invalid DOCX file signature")