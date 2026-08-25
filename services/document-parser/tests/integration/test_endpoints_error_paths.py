import io
import time
import zipfile

import pytest

import app.core.config as config_module

pytestmark = pytest.mark.integration

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _minimal_docx_bytes() -> bytes:
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>Integration body</w:t></w:r></w:p></w:body>"
        "</w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            "</Types>",
        )
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            "</Relationships>",
        )
        archive.writestr("word/document.xml", document_xml)
    return buffer.getvalue()


@pytest.fixture
def small_upload_limit(mocker):
    mocker.patch.object(config_module.settings, "MAX_UPLOAD_SIZE_BYTES", 64)


@pytest.fixture
def tiny_docx_limit(mocker):
    mocker.patch.object(config_module.settings, "MAX_DOCX_UNCOMPRESSED_BYTES", 16)


@pytest.fixture
def fast_timeout(mocker):
    mocker.patch.object(config_module.settings, "EXTRACTION_TIMEOUT_SECONDS", 0.05)


def test_oversized_upload_rejected_with_413(client, small_upload_limit):
    files = {"file": ("big.txt", b"x" * 128, "text/plain")}

    response = client.post("/extract", files=files)

    assert response.status_code == 413
    assert "exceeds limit" in response.json()["detail"]


def test_decompression_bomb_docx_rejected_with_413(client, tiny_docx_limit, mocker):
    mocker.patch("app.api.deps.magic.from_buffer", return_value=DOCX_MIME)
    files = {"file": ("bomb.docx", _minimal_docx_bytes(), DOCX_MIME)}

    response = client.post("/extract", files=files)

    assert response.status_code == 413
    assert "Document content size" in response.json()["detail"]


def test_corrupt_pdf_returns_sanitized_422(client):
    files = {"file": ("broken.pdf", b"%PDF-1.4 broken xref garbage", "application/pdf")}

    response = client.post("/extract", files=files)

    assert response.status_code == 422
    assert response.json()["detail"] == "Could not extract text from this document."


def test_slow_extraction_times_out_with_504(client, fast_timeout, mocker):
    mocker.patch(
        "app.domain.extraction.strategies.PdfExtractionStrategy.extract",
        side_effect=lambda _path: time.sleep(0.5),
    )
    files = {"file": ("slow.pdf", b"%PDF-1.4\n", "application/pdf")}

    response = client.post("/extract", files=files)

    assert response.status_code == 504
    assert "timed out" in response.json()["detail"]
