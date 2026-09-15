import os
import time

from opentelemetry import trace

from app.application.dto import ExtractCommand
from app.core.config import settings
from app.domain.cleaner import TextCleaner
from app.domain.entities import ExtractionResult
from app.domain.exceptions import FileTooLargeError
from app.infrastructure.executor.extraction_pool import (
    mark_extraction_finished,
    mark_extraction_started,
    refresh_pool_gauges,
)
from app.infrastructure.observability.metrics import (
    classify_extraction_error,
    record_extraction,
    record_extraction_duration,
    record_extraction_failure,
    record_extraction_queue_wait,
)
from app.infrastructure.parsers.factory import ExtractorFactory
from app.infrastructure.storage.tempfile_store import TempFileStore

tracer = trace.get_tracer(__name__)
_store = TempFileStore()


def run_extraction_task(command: ExtractCommand, submitted_at: float) -> ExtractionResult:
    record_extraction_queue_wait(
        mime_type=command.mime_type, wait_seconds=max(0.0, time.perf_counter() - submitted_at)
    )
    mark_extraction_started()
    try:
        return ExtractDocumentUseCase().execute(command)
    finally:
        mark_extraction_finished()
        refresh_pool_gauges()


class ExtractDocumentUseCase:
    def __init__(self, store: TempFileStore | None = None, factory: type[ExtractorFactory] | None = None):
        self._store = store or _store
        self._factory = factory or ExtractorFactory

    def execute(self, cmd: ExtractCommand) -> ExtractionResult:
        if len(cmd.content) > settings.MAX_UPLOAD_SIZE_BYTES:
            raise FileTooLargeError(len(cmd.content), settings.MAX_UPLOAD_SIZE_BYTES)

        suffix = os.path.splitext(cmd.filename or "")[1]
        path = self._store.save(cmd.content, suffix)
        try:
            strategy = self._factory.get(cmd.mime_type)
            with tracer.start_as_current_span("extraction") as span:
                span.set_attribute("mime_type", cmd.mime_type)
                span.set_attribute("file_size", len(cmd.content))
                started = time.perf_counter()
                try:
                    raw = strategy.extract(path)
                except Exception:
                    record_extraction_duration(
                        mime_type=cmd.mime_type, status="error", duration_seconds=time.perf_counter() - started
                    )
                    raise
                record_extraction_duration(
                    mime_type=cmd.mime_type, status="success", duration_seconds=time.perf_counter() - started
                )
                cleaned = TextCleaner.clean(raw.text)
                span.set_attribute("text_length", len(cleaned.encode("utf-8")))
                span.set_attribute("truncated", raw.truncated)
                record_extraction(
                    mime_type=cmd.mime_type,
                    file_size_bytes=len(cmd.content),
                    text_bytes=len(cleaned.encode("utf-8")),
                )
                return ExtractionResult(text=cleaned, truncated=raw.truncated)
        except Exception as exc:
            record_extraction_failure(
                mime_type=cmd.mime_type,
                file_size_bytes=len(cmd.content),
                error_type=classify_extraction_error(exc),
            )
            raise
        finally:
            self._store.cleanup(path)
