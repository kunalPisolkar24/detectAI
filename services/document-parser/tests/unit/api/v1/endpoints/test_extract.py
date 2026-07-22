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
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", return_value="text/plain")
    mocker.patch("app.domain.extraction.service.ExtractionService.process_file", return_value="Extracted Content")

    files = {"file": ("test.txt", b"Content", "text/plain")}
    response = client.post("/extract", files=files)

    assert response.status_code == 200
    assert response.json()["text"] == "Extracted Content"

def test_invalid_mime_type(client, mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="image/png")
    files = {"file": ("image.png", b"\x89PNG\r\n\x1a\n", "image/png")}
    response = client.post("/extract", files=files)
    assert response.status_code == 415

def test_content_type_mismatch_rejected(client, mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value="image/png")
    files = {"file": ("spoof.pdf", b"\x89PNG\r\n\x1a\n", "application/pdf")}
    response = client.post("/extract", files=files)
    assert response.status_code == 415

def test_file_too_large(client, mocker):
    from app.core.exceptions import FileTooLargeError
    mocker.patch("app.api.v1.endpoints.extract.validate_upload", side_effect=FileTooLargeError(20, 10))

    files = {"file": ("large.txt", b"too big", "text/plain")}
    response = client.post("/extract", files=files)
    assert response.status_code == 413
