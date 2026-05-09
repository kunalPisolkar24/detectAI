import pytest
from unittest.mock import MagicMock, patch
from app.domain.extraction.strategies import ExtractorFactory, PdfExtractionStrategy, DocxExtractionStrategy, TxtExtractionStrategy
from app.core.exceptions import ExtractionError

def test_extract_pdf_success():
    mock_page = MagicMock()
    mock_page.get_text.return_value = "PDF Content"
    mock_doc = MagicMock()
    mock_doc.__iter__.return_value = [mock_page]
    mock_doc.__enter__.return_value = mock_doc

    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=mock_doc):
        result = strategy.extract("dummy.pdf")
        assert result == "PDF Content"

def test_extract_docx_success():
    p1 = MagicMock(text="Para 1")
    mock_doc = MagicMock(paragraphs=[p1])

    strategy = DocxExtractionStrategy()
    with patch("docx.Document", return_value=mock_doc):
        result = strategy.extract("dummy.docx")
        assert result == "Para 1"

def test_extract_txt_utf8():
    strategy = TxtExtractionStrategy()
    with patch("builtins.open", MagicMock(return_value=MagicMock(__enter__=lambda s: MagicMock(read=lambda: b"Hello World")))):
        result = strategy.extract("dummy.txt")
        assert result == "Hello World"

def test_factory_returns_correct_strategy():
    assert isinstance(ExtractorFactory.get_strategy("application/pdf"), PdfExtractionStrategy)
    assert isinstance(ExtractorFactory.get_strategy("text/plain"), TxtExtractionStrategy)

def test_factory_raises_on_unknown_mime():
    with pytest.raises(ExtractionError):
        ExtractorFactory.get_strategy("image/png")
