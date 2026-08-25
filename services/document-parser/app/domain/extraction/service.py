import os
import tempfile
import time
from fastapi import UploadFile
from app.core.config import settings
from app.core.exceptions import FileTooLargeError
from app.core.metrics import (
    classify_extraction_error,
    record_extraction,
    record_extraction_duration,
    record_extraction_failure,
    record_extraction_queue_wait,
    refresh_process_pool_gauges,
)
from app.domain.extraction.strategies import ExtractorFactory, ExtractionResult
from app.domain.extraction.cleaner import TextCleaner


def run_extraction_task(file: UploadFile, mime_type: str, submitted_at: float) -> ExtractionResult:
    record_extraction_queue_wait(
        mime_type=mime_type,
        wait_seconds=max(0.0, time.perf_counter() - submitted_at),
    )
    refresh_process_pool_gauges()
    return ExtractionService.process_file(file, mime_type)


class ExtractionService:
    @staticmethod
    def process_file(file: UploadFile, mime_type: str) -> ExtractionResult:
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

                extraction_started = time.perf_counter()
                try:
                    raw_result = strategy.extract(tmp_path)
                except Exception:
                    record_extraction_duration(
                        mime_type=mime_type,
                        status="error",
                        duration_seconds=time.perf_counter() - extraction_started,
                    )
                    raise
                record_extraction_duration(
                    mime_type=mime_type,
                    status="success",
                    duration_seconds=time.perf_counter() - extraction_started,
                )

                cleaned_text = TextCleaner.clean(raw_result.text)

                record_extraction(
                    mime_type=mime_type,
                    file_size_bytes=file_size_bytes,
                    text_bytes=len(cleaned_text.encode("utf-8")),
                )

                return ExtractionResult(text=cleaned_text, truncated=raw_result.truncated)
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
