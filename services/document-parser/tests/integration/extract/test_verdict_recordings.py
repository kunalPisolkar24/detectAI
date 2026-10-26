"""The route's verdict recordings against a recording stub of the seam:
every row of observability.md's verdict table, with the instrument fold
itself left to the facade's own tests. The wire shapes double-check the
statuses the recordings ride, and the 401 proves transport-level guards
record nothing.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.extract import router as extract_router
from app.config import Settings
from app.extraction import (
    DocumentExtractionService,
    build_default_extraction_service,
)
from app.validation import build_default_service
from app.validation.models import (
    DEFAULT_MAX_PDF_PAGES,
    DEFAULT_UPLOAD_LIMIT_BYTES,
)
from tests.support.documents import (
    docx_body_bytes,
    minimal_pdf_bytes,
    positioned_pdf_bytes,
)
from tests.support.observability import RecordingObservability

from .conftest import KEY

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_PDF_TEXT = "doc parser probe pdf line"
_PDF = positioned_pdf_bytes([[(400.0, _PDF_TEXT)]])
_BLANK_PDF = minimal_pdf_bytes(1)
_THREE_PAGE_PDF = positioned_pdf_bytes(
    [[(400.0, f"page {index} line")] for index in range(3)]
)
_UNCLOSED_DOCX_XML = docx_body_bytes("<w:p><w:r><w:t>unclosed")
_PNG_SNIFF = b"\x89PNG\r\n\x1a\n body"
_DEAD_PDF = b"%PDF-1.7 no container behind the signature"

_GENERIC_422 = {"detail": "corrupt or unsupported upload"}
_BUDGET_504 = {"detail": "the processing budget was exceeded"}


def _client(
    recorder: RecordingObservability,
    *,
    upload_limit_bytes: int = DEFAULT_UPLOAD_LIMIT_BYTES,
    max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES,
    extraction: DocumentExtractionService | None = None,
) -> TestClient:
    """The state the lifespan would install, with the recorder standing in
    for the wired service — what these rows vary is what the route records."""
    throwaway = FastAPI()
    throwaway.include_router(extract_router)
    throwaway.state.settings = Settings(
        api_key=KEY, upload_limit_bytes=upload_limit_bytes
    )
    throwaway.state.validation_service = build_default_service(
        max_pdf_pages=max_pdf_pages
    )
    throwaway.state.extraction_service = (
        extraction or build_default_extraction_service()
    )
    throwaway.state.observability = recorder
    return TestClient(throwaway)


def test_an_ok_attempt_folds_onto_the_seam() -> None:
    recorder = RecordingObservability()
    client = _client(recorder)

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("a.pdf", _PDF, "application/pdf")},
    )

    assert response.status_code == 200
    assert recorder.rejections == []
    (fold,) = recorder.extractions
    assert fold.mime_type == "application/pdf"
    assert fold.outcome == "ok"
    assert 0 < fold.duration_seconds < 5
    assert recorder.request_brackets == 1
    assert recorder.extraction_brackets == ["application/pdf"]
    assert recorder.open_brackets == 0


def test_a_pinched_cap_folds_the_truncated_verdict() -> None:
    recorder = RecordingObservability()
    client = _client(
        recorder, extraction=build_default_extraction_service(output_char_limit=4)
    )

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("cap.txt", b"abcde", "text/plain")},
    )

    assert response.status_code == 200
    (fold,) = recorder.extractions
    assert (fold.mime_type, fold.outcome) == ("text/plain", "truncated")


def test_a_spent_budget_folds_the_timeout_verdict() -> None:
    recorder = RecordingObservability()
    client = _client(
        recorder,
        extraction=build_default_extraction_service(processing_budget_seconds=0.0),
    )

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("book.pdf", _THREE_PAGE_PDF, "application/pdf")},
    )

    assert response.status_code == 504
    (fold,) = recorder.extractions
    assert (fold.mime_type, fold.outcome) == ("application/pdf", "timeout")
    assert recorder.rejections == []


def test_content_that_dies_after_admission_folds_unreadable() -> None:
    fails = [
        (_BLANK_PDF, "application/pdf", "scanned.pdf"),
        (_UNCLOSED_DOCX_XML, _DOCX_MIME, "broken.docx"),
    ]
    for body, mime, name in fails:
        recorder = RecordingObservability()
        client = _client(recorder)

        response = client.post(
            "/api/v1/extract",
            headers={"x-api-key": KEY},
            files={"file": (name, body, mime)},
        )

        assert response.status_code == 422
        assert response.json() == _GENERIC_422
        (fold,) = recorder.extractions
        assert (fold.mime_type, fold.outcome) == (mime, "unreadable")


def test_a_body_over_the_pinched_bound_rejects_too_large() -> None:
    recorder = RecordingObservability()
    client = _client(recorder, upload_limit_bytes=16)

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("big.txt", b"x" * 17, "text/plain")},
    )

    assert response.status_code == 413
    assert recorder.rejections == ["too_large"]
    assert recorder.extractions == []


def test_a_pdf_over_the_page_bound_rejects_too_large() -> None:
    recorder = RecordingObservability()
    client = _client(recorder, max_pdf_pages=2)

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("big.pdf", _THREE_PAGE_PDF, "application/pdf")},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "the pdf exceeds the 2-page limit"}
    assert recorder.rejections == ["too_large"]


def test_a_sniff_the_registry_does_not_know_rejects_unsupported() -> None:
    recorder = RecordingObservability()
    client = _client(recorder)

    response = client.post(
        "/api/v1/extract",
        headers={"x-api-key": KEY},
        files={"file": ("fake.pdf", _PNG_SNIFF, "application/pdf")},
    )

    assert response.status_code == 415
    assert response.json() == {"detail": "unsupported document type: image/png"}
    assert recorder.rejections == ["unsupported_type"]


@pytest.mark.parametrize(
    ("files", "content_type", "content"),
    [
        (
            {"other": ("x.txt", b"body", "text/plain")},
            None,
            None,
        ),  # a field nobody wants
        ({}, None, None),  # no parts at all: no multipart content-type to parse
        (None, "multipart/form-data; boundary=x", b"\x00\x01 not really multipart"),
    ],
)
def test_an_unparseable_multipart_rejects_malformed(
    files: dict[str, tuple[str, bytes, str]] | None,
    content_type: str | None,
    content: bytes | None,
) -> None:
    recorder = RecordingObservability()
    client = _client(recorder)

    headers = {"x-api-key": KEY}
    if content_type is not None:
        headers["Content-Type"] = content_type
    response = client.post(
        "/api/v1/extract", headers=headers, files=files, content=content
    )

    assert response.status_code == 422
    assert response.json() == _GENERIC_422
    assert recorder.rejections == ["malformed"]
    assert recorder.extractions == []


def test_the_401_guards_the_wire_before_any_recording() -> None:
    recorder = RecordingObservability()
    client = _client(recorder)

    response = client.post(
        "/api/v1/extract", files={"file": ("a.txt", b"body", "text/plain")}
    )

    assert response.status_code == 401
    assert recorder.rejections == []
    assert recorder.extractions == []
    assert recorder.request_brackets == 0
