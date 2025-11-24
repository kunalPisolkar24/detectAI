from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

def test_extract_txt_success(mocker):
    mock_process = mocker.patch("app.services.extractor.FileExtractor.process")
    mock_process.return_value = "Mocked Extracted Text"

    files = {
        "file": ("test.txt", b"Content", "text/plain")
    }
    
    response = client.post("/extract", files=files)
    
    assert response.status_code == 200
    json_resp = response.json()
    assert json_resp["filename"] == "test.txt"
    assert json_resp["text"] == "Mocked Extracted Text"

def test_extract_pdf_success_mocked(mocker):
    mock_process = mocker.patch("app.services.extractor.FileExtractor.process")
    mock_process.return_value = "PDF Content"

    pdf_header = b"%PDF-1.4 dummy content" 
    
    files = {
        "file": ("doc.pdf", pdf_header, "application/pdf")
    }

    response = client.post("/extract", files=files)

    assert response.status_code == 200
    assert response.json()["text"] == "PDF Content"

def test_extract_docx_success_mocked(mocker):
    mock_process = mocker.patch("app.services.extractor.FileExtractor.process")
    mock_process.return_value = "DOCX Content"

    docx_header = b"PK\x03\x04 dummy content"
    
    files = {
        "file": ("doc.docx", docx_header, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    }

    response = client.post("/extract", files=files)

    assert response.status_code == 200
    assert response.json()["text"] == "DOCX Content"

def test_invalid_mime_type():
    files = {
        "file": ("image.png", b"image data", "image/png")
    }
    response = client.post("/extract", files=files)
    assert response.status_code == 415
    assert "Unsupported media type" in response.json()["detail"]

def test_invalid_magic_number_pdf():
    files = {
        "file": ("fake.pdf", b"This is not a pdf", "application/pdf")
    }
    response = client.post("/extract", files=files)
    assert response.status_code == 400
    assert "Invalid PDF" in response.json()["detail"]

def test_file_too_large(mocker):
    mocker.patch("app.config.settings.MAX_UPLOAD_SIZE_BYTES", 10)
    
    files = {
        "file": ("large.txt", b"This string is longer than 10 bytes", "text/plain")
    }
    response = client.post("/extract", files=files)
    assert response.status_code == 413

def test_internal_server_error(mocker):
    mocker.patch("app.utils.validator.validate_file") 
    mock_process = mocker.patch("app.services.extractor.FileExtractor.process")
    mock_process.side_effect = Exception("Unexpected Crash")

    files = {
        "file": ("crash.txt", b"data", "text/plain")
    }
    response = client.post("/extract", files=files)
    assert response.status_code == 500
    assert response.json()["detail"] == "Internal processing error"