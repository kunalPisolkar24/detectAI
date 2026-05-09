from fastapi.testclient import TestClient
from app.main import app
import pytest

import pytest

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_extract_txt_success(client, mocker):
    mocker.patch("app.main.validate_file", return_value=None)
    mocker.patch("app.services.orchestrator.ExtractionOrchestrator.process_file", return_value="Extracted Content")

    files = {"file": ("test.txt", b"Content", "text/plain")}
    response = client.post("/extract", files=files)
    
    assert response.status_code == 200
    assert response.json()["text"] == "Extracted Content"

def test_invalid_mime_type(client):
    files = {"file": ("image.png", b"data", "image/png")}
    response = client.post("/extract", files=files)
    assert response.status_code == 415

def test_file_too_large(client, mocker):
    from app.exceptions import FileTooLargeError
    mocker.patch("app.main.validate_file", side_effect=FileTooLargeError(20, 10))
    
    files = {"file": ("large.txt", b"too big", "text/plain")}
    response = client.post("/extract", files=files)
    assert response.status_code == 413
