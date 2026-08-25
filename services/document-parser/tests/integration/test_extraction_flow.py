import io
import os
import pytest

pytestmark = pytest.mark.integration

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


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_extract_strips_pdf_header_footer_banners(client, mocker):
    import fitz

    mocker.patch("app.api.deps.magic.from_buffer", return_value="application/pdf")
    buffer = io.BytesIO()
    with fitz.open() as doc:
        page = doc.new_page(width=612, height=792)
        page.insert_text((72, 25), "HEADER CANARY", fontname="helv", fontsize=11)
        page.insert_text((72, 500), "Real body content", fontname="helv", fontsize=11)
        page.insert_text((72, 770), "FOOTER CANARY", fontname="helv", fontsize=11)
        doc.save(buffer)

    files = {"file": ("banner.pdf", buffer.getvalue(), "application/pdf")}
    response = client.post("/extract", files=files)

    assert response.status_code == 200
    text = response.json()["text"]
    assert "HEADER CANARY" not in text
    assert "FOOTER CANARY" not in text
    assert "Real body content" in text


def test_extract_excludes_docx_footnote_content(client, mocker):
    import zipfile

    mocker.patch("app.api.deps.magic.from_buffer", return_value=DOCX_MIME)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>Visible body</w:t></w:r></w:p></w:body>"
        "</w:document>"
    )
    footnotes_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:footnote w:type="normal" w:id="1"><w:p><w:r><w:t>FOOTNOTE LEAK CANARY</w:t></w:r></w:p></w:footnote>'
        "</w:footnotes>"
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
        archive.writestr("word/footnotes.xml", footnotes_xml)

    files = {"file": ("with-footnotes.docx", buffer.getvalue(), DOCX_MIME)}
    response = client.post("/extract", files=files)

    assert response.status_code == 200
    text = response.json()["text"]
    assert "FOOTNOTE LEAK CANARY" not in text
    assert "Visible body" in text
