import os
import tempfile
from fastapi import UploadFile
from app.core.config import settings
from app.core.exceptions import FileTooLargeError
from app.core.metrics import classify_extraction_error, record_extraction, record_extraction_failure
from app.domain.extraction.strategies import ExtractorFactory
from app.domain.extraction.cleaner import TextCleaner


class ExtractionService:
    @staticmethod
    def process_file(file: UploadFile, mime_type: str) -> str:
        suffix = os.path.splitext(file.filename or "")[1]

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            try:
                content = file.file.read()
                file_size_bytes = len(content)
                if file_size_bytes > settings.MAX_UPLOAD_SIZE_BYTES:
                    raise FileTooLargeError(file_size_bytes, settings.MAX_UPLOAD_SIZE_BYTES)
                tmp.write(content)
                tmp.flush()

                strategy = ExtractorFactory.get_strategy(mime_type)
                raw_text = strategy.extract(tmp_path)
                cleaned_text = TextCleaner.clean(raw_text)

                record_extraction(
                    mime_type=mime_type,
                    file_size_bytes=file_size_bytes,
                    text_bytes=len(cleaned_text.encode("utf-8")),
                )

                return cleaned_text
            except Exception as exc:
                record_extraction_failure(
                    mime_type=mime_type,
                    file_size_bytes=len(content) if "content" in dir() else 0,
                    error_type=classify_extraction_error(exc),
                )
                raise
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
