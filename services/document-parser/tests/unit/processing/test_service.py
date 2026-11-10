"""The processing facade with every real strategy and a recording stub on
the seam: one call answers the sniffed MIME plus the extract, folds each
verdict row where the mime and duration are known, and re-raises so the
route maps statuses. Unit tree: no app boot."""

import pytest

from app.processing import (
    BudgetExhaustedError,
    CorruptDocumentError,
    DocumentProcessingService,
    ProcessedDocument,
    TooLargeError,
    UnreadableDocumentError,
    UnsupportedTypeError,
    build_default_extraction_service,
    build_default_service,
)
from app.processing.extraction.models import (
    DEFAULT_OUTPUT_CHAR_LIMIT,
    DEFAULT_PROCESSING_BUDGET_SECONDS,
)
from app.processing.validation.models import DEFAULT_MAX_PDF_PAGES
from tests.support.documents import (
    minimal_pdf_bytes,
    positioned_pdf_bytes,
    surrogate_zip_bytes,
)
from tests.support.observability import RecordingObservability

_PDF_TEXT = "doc parser probe pdf line"
_PDF = positioned_pdf_bytes([[(400.0, _PDF_TEXT)]])
_PNG_SNIFF = b"\x89PNG\r\n\x1a\n body"
_BLANK_PDF = minimal_pdf_bytes(1)
_THREE_PAGE_PDF = positioned_pdf_bytes(
    [[(400.0, f"page {index} line")] for index in range(3)]
)


def _service(
    recorder: RecordingObservability,
    *,
    max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES,
    processing_budget_seconds: float = DEFAULT_PROCESSING_BUDGET_SECONDS,
    output_char_limit: int = DEFAULT_OUTPUT_CHAR_LIMIT,
) -> DocumentProcessingService:
    """The production composition with the recording stub standing in for the seam."""
    return DocumentProcessingService(
        build_default_service(max_pdf_pages=max_pdf_pages),
        build_default_extraction_service(
            processing_budget_seconds=processing_budget_seconds,
            output_char_limit=output_char_limit,
        ),
        recorder,
    )


def test_an_admitted_body_answers_the_sniffed_mime_and_the_extract() -> None:
    recorder = RecordingObservability()
    service = _service(recorder)

    outcome = service.process(_PDF)

    assert outcome == ProcessedDocument(
        mime="application/pdf", text=_PDF_TEXT, truncated=False
    )
    (fold,) = recorder.extractions
    assert fold.mime_type == "application/pdf"
    assert fold.outcome == "ok"
    assert 0 <= fold.duration_seconds < 5
    assert recorder.rejections == []
    assert recorder.extraction_brackets == [("application/pdf", len(_PDF))]


def test_the_plumbing_keeps_the_sniffed_mime_even_for_the_humble_text() -> None:
    recorder = RecordingObservability()
    service = _service(recorder)

    outcome = service.process(b"body\n")

    assert outcome == ProcessedDocument(mime="text/plain", text="body", truncated=False)
    (fold,) = recorder.extractions
    assert fold.mime_type == "text/plain"


def test_a_pinched_output_cap_folds_the_truncated_verdict() -> None:
    recorder = RecordingObservability()
    service = _service(recorder, output_char_limit=4)

    outcome = service.process(b"abcde")

    assert outcome == ProcessedDocument(mime="text/plain", text="abcd", truncated=True)
    (fold,) = recorder.extractions
    assert (fold.mime_type, fold.outcome) == ("text/plain", "truncated")


def test_a_spent_budget_folds_the_timeout_verdict_and_re_raises() -> None:
    recorder = RecordingObservability()
    service = _service(recorder, processing_budget_seconds=0.0)

    with pytest.raises(BudgetExhaustedError):
        service.process(_THREE_PAGE_PDF)

    (fold,) = recorder.extractions
    assert (fold.mime_type, fold.outcome) == ("application/pdf", "timeout")
    assert 0 <= fold.duration_seconds < 5
    assert recorder.extraction_brackets == [
        ("application/pdf", len(_THREE_PAGE_PDF))
    ]
    assert recorder.open_brackets == 0
    assert recorder.rejections == []


def test_content_that_dies_after_admission_folds_unreadable() -> None:
    recorder = RecordingObservability()
    service = _service(recorder)

    with pytest.raises(UnreadableDocumentError):
        service.process(_BLANK_PDF)

    (fold,) = recorder.extractions
    assert (fold.mime_type, fold.outcome) == ("application/pdf", "unreadable")
    assert recorder.rejections == []


def test_a_sniff_the_registry_does_not_know_folds_unsupported_and_stops() -> None:
    recorder = RecordingObservability()
    service = _service(recorder)

    with pytest.raises(UnsupportedTypeError, match="image/png"):
        service.process(_PNG_SNIFF)

    assert recorder.rejections == ["unsupported_type"]
    assert recorder.extractions == []
    assert recorder.extraction_brackets == []


def test_a_pdf_over_the_page_bound_folds_too_large_and_stops() -> None:
    recorder = RecordingObservability()
    service = _service(recorder, max_pdf_pages=2)

    with pytest.raises(TooLargeError, match="2-page"):
        service.process(_THREE_PAGE_PDF)

    assert recorder.rejections == ["too_large"]
    assert recorder.extractions == []
    assert recorder.extraction_brackets == []


def test_a_zip_that_is_not_a_docx_folds_corrupt_and_stops() -> None:
    recorder = RecordingObservability()
    service = _service(recorder)

    with pytest.raises(CorruptDocumentError):
        service.process(surrogate_zip_bytes(["ppt/presentation.xml", "docProps/core.xml"]))

    assert recorder.rejections == ["corrupt"]
    assert recorder.extractions == []
    assert recorder.extraction_brackets == []
