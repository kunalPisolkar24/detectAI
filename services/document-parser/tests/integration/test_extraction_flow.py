import pytest
import os
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

@pytest.fixture
def fixtures_dir():
    return os.path.join(os.path.dirname(__file__), "fixtures")

@pytest.mark.integration
def test_full_extraction_txt(client, fixtures_dir):
    file_path = os.path.join(fixtures_dir, "sample.txt")
    with open(file_path, "rb") as f:
        files = {"file": ("sample.txt", f, "text/plain")}
        response = client.post("/extract", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "sample.txt"
    assert "Hello Integration Test TXT" in data["text"]

@pytest.mark.integration
def test_full_extraction_pdf(client, fixtures_dir):
    file_path = os.path.join(fixtures_dir, "sample.pdf")
    with open(file_path, "rb") as f:
        files = {"file": ("sample.pdf", f, "application/pdf")}
        response = client.post("/extract", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "sample.pdf"
    assert "Hello Integration Test PDF" in data["text"]

@pytest.mark.integration
def test_full_extraction_docx(client, fixtures_dir):
    file_path = os.path.join(fixtures_dir, "sample.docx")
    with open(file_path, "rb") as f:
        files = {"file": ("sample.docx", f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        response = client.post("/extract", files=files)
    
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "sample.docx"
    assert "Hello Integration Test DOCX" in data["text"]

@pytest.mark.integration
def test_extraction_unsupported_type_rejected(client):
    # GIF header is detected as image/gif, which is not an allowed type
    files = {"file": ("document.gif", b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x00\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;", "image/gif")}
    response = client.post("/extract", files=files)

    assert response.status_code == 415
    assert "Unsupported media type" in response.json()["detail"]
