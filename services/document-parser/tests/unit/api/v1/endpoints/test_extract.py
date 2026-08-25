import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_extract_txt_success(client, mocker):
    from app.domain.extraction.strategies import ExtractionResult
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="text/plain")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        return_value=ExtractionResult(text="Extracted Content"),
    )

    files = {"file": ("test.txt", b"Content", "text/plain")}
    response = client.post("/extract", files=files)

    assert response.status_code == 200
    assert response.json()["text"] == "Extracted Content"
    assert response.json()["truncated"] is False

def test_extract_reports_truncation(client, mocker):
    from app.domain.extraction.strategies import ExtractionResult
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="application/pdf")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        return_value=ExtractionResult(text="Partial content", truncated=True),
    )

    files = {"file": ("broken.pdf", b"%PDF-broken", "application/pdf")}
    response = client.post("/extract", files=files)

    assert response.status_code == 200
    assert response.json()["truncated"] is True
    assert response.json()["text_length"] == len("Partial content")

def test_invalid_mime_type(client, mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="image/png")
    files = {"file": ("image.png", b"\x89PNG\r\n\x1a\n", "image/png")}
    response = client.post("/extract", files=files)
    assert response.status_code == 415

def test_rejected_uploads_counted_by_reason(client, mocker):
    from app.core.metrics import render_metrics
    from tests.unit.core.test_metrics import _metric_value

    mocker.patch("app.api.deps.magic.from_buffer", return_value="image/zip")
    files = {"file": ("archive.png", b"PK\x03\x04", "application/pdf")}
    response = client.post("/extract", files=files)

    assert response.status_code == 415
    payload, _ = render_metrics()
    series = 'rejected_uploads_total{reason="unsupported_type"}'
    before = _metric_value(payload, series)
    assert before is not None and before >= 1.0

def test_content_type_mismatch_rejected(client, mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="image/png")
    files = {"file": ("spoof.pdf", b"\x89PNG\r\n\x1a\n", "application/pdf")}
    response = client.post("/extract", files=files)
    assert response.status_code == 415

# The early size guard (deps.py:8) uses file.size from the Content-Length header.
# When Content-Length is absent (chunked transfer), file.size is None and the guard
# is silently skipped. This is intentional — the fast-fail is a best-effort benefit
# for honest clients. The authoritative size check runs in the thread pool
# (service.py:21) and cannot be bypassed. FastAPI's TestClient always sets
# Content-Length, so a unit test for the None path is not feasible here.

def test_file_too_large(client, mocker):
    from app.core.exceptions import FileTooLargeError
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", side_effect=FileTooLargeError(20, 10))

    files = {"file": ("large.txt", b"too big", "text/plain")}
    response = client.post("/extract", files=files)
    assert response.status_code == 413

def test_extraction_error_returns_safe_detail(client, mocker):
    from app.core.exceptions import ExtractionError
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="application/pdf")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        side_effect=ExtractionError("PDF processing failed: Mupdf: cannot find startxref"),
    )

    files = {"file": ("broken.pdf", b"%PDF-broken", "application/pdf")}
    response = client.post("/extract", files=files)

    assert response.status_code == 422
    assert response.json()["detail"] == "Could not extract text from this document."
    assert "Mupdf" not in response.text
    assert "startxref" not in response.text

def test_document_too_large_returns_413(client, mocker):
    from app.core.exceptions import DocumentTooLargeError
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="application/pdf")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        side_effect=DocumentTooLargeError(200 * 1024 * 1024, 100 * 1024 * 1024),
    )

    files = {"file": ("bomb.pdf", b"%PDF-bomb", "application/pdf")}
    response = client.post("/extract", files=files)

    assert response.status_code == 413
    assert "exceeds limit" in response.json()["detail"]

def test_slow_extraction_times_out(client, mocker):
    import time
    import app.core.config as config_module

    mocker.patch.object(config_module.settings, "EXTRACTION_TIMEOUT_SECONDS", 0.05)
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="text/plain")
    mocker.patch(
        "app.domain.extraction.service.ExtractionService.process_file",
        side_effect=lambda *args: time.sleep(0.5),
    )

    files = {"file": ("slow.txt", b"content", "text/plain")}
    response = client.post("/extract", files=files)

    assert response.status_code == 504
    assert "timed out" in response.json()["detail"]
