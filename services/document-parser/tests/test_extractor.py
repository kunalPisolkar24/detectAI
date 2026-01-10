import pytest
from unittest.mock import MagicMock, patch
from fastapi import UploadFile
from app.services.extractor import FileExtractor

def test_extract_txt_utf8():
    content = b"Hello World"
    result = FileExtractor.extract_txt(content)
    assert result == "Hello World"

def test_extract_txt_latin1():
    content = b"Caf\xe9"
    result = FileExtractor.extract_txt(content)
    assert result == "Café"

def test_extract_txt_fail():
    mock_bytes = MagicMock()
    mock_bytes.decode.side_effect = [
        UnicodeDecodeError('utf-8', b"", 0, 1, 'bad'),
        Exception("Simulated Decode Error")
    ]
    
    with pytest.raises(ValueError) as exc:
        FileExtractor.extract_txt(mock_bytes)
        
    assert "Text decoding failed" in str(exc.value)

def test_extract_pdf_success():
    mock_page1 = MagicMock()
    mock_page1.get_text.return_value = "Page 1 content. "
    
    mock_page2 = MagicMock()
    mock_page2.get_text.return_value = "Page 2 content."
    
    mock_doc = MagicMock()
    mock_doc.__iter__.return_value = [mock_page1, mock_page2]
    mock_doc.__enter__.return_value = mock_doc
    mock_doc.__exit__.return_value = None

    with patch("fitz.open", return_value=mock_doc):
        result = FileExtractor.extract_pdf(b"dummy pdf bytes")
        assert result == "Page 1 content. \nPage 2 content."

def test_extract_pdf_error():
    with patch("fitz.open", side_effect=Exception("Corrupt PDF")):
        with pytest.raises(ValueError) as exc:
            FileExtractor.extract_pdf(b"bad bytes")
        assert "PDF processing failed" in str(exc.value)

def test_extract_docx_success():
    p1 = MagicMock()
    p1.text = "Paragraph 1"
    p2 = MagicMock()
    p2.text = "Paragraph 2"
    p3 = MagicMock()
    p3.text = "   "
    
    mock_doc = MagicMock()
    mock_doc.paragraphs = [p1, p3, p2]

    with patch("docx.Document", return_value=mock_doc):
        result = FileExtractor.extract_docx(b"dummy docx bytes")
        assert result == "Paragraph 1\nParagraph 2"

def test_extract_docx_error():
    with patch("docx.Document", side_effect=Exception("Bad DOCX")):
        with pytest.raises(ValueError) as exc:
            FileExtractor.extract_docx(b"bad bytes")
        assert "DOCX processing failed" in str(exc.value)

def test_process_dispatcher(mocker):
    m_pdf = mocker.patch.object(FileExtractor, "extract_pdf", return_value="PDF")
    m_docx = mocker.patch.object(FileExtractor, "extract_docx", return_value="DOCX")
    m_txt = mocker.patch.object(FileExtractor, "extract_txt", return_value="TXT")

    file_mock = MagicMock(spec=UploadFile)
    
    file_mock.content_type = "application/pdf"
    assert FileExtractor.process(file_mock, b"") == "PDF"
    m_pdf.assert_called_once()
    
    file_mock.content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert FileExtractor.process(file_mock, b"") == "DOCX"
    m_docx.assert_called_once()
    
    file_mock.content_type = "text/plain"
    assert FileExtractor.process(file_mock, b"") == "TXT"
    m_txt.assert_called_once()

    file_mock.content_type = "image/png"
    with pytest.raises(ValueError) as exc:
        FileExtractor.process(file_mock, b"")
    assert "Unsupported file type" in str(exc.value)