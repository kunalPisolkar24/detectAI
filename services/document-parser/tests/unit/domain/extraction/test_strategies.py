import pytest
from unittest.mock import MagicMock, patch
from app.domain.extraction.strategies import ExtractorFactory, PdfExtractionStrategy, DocxExtractionStrategy, TxtExtractionStrategy
from app.core.exceptions import ExtractionError

def _make_pdf_page(blocks, height=842.0):
    page = MagicMock()
    page.get_text.return_value = blocks
    page.rect.height = height
    return page

def test_extract_pdf_success():
    blocks = [(0, 100, 500, 150, "PDF Content", 0, 0)]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(_make_pdf_page(blocks))):
        result = strategy.extract("dummy.pdf")
        assert result.text == "PDF Content"

def test_extract_pdf_skips_header_footer_blocks():
    blocks = [
        (0, 10, 300, 30, "Header banner", 0, 0),
        (0, 100, 500, 400, "Body paragraph", 1, 0),
        (0, 810, 300, 830, "Footer page 3", 2, 0),
    ]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(_make_pdf_page(blocks))):
        result = strategy.extract("dummy.pdf")
        assert result.text == "Body paragraph"

def test_extract_pdf_ignores_image_blocks():
    blocks = [
        (0, 100, 200, 300, "<image: DeviceRGB>", 0, 1),
        (0, 320, 200, 380, "Text after image", 1, 0),
    ]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(_make_pdf_page(blocks))):
        result = strategy.extract("dummy.pdf")
        assert result.text == "Text after image"

def test_extract_pdf_skips_blocks_partially_in_band_only_if_fully_inside():
    blocks = [
        (0, 20, 300, 120, "Heading touching header band", 0, 0),
        (0, 760, 300, 830, "Paragraph touching footer band", 1, 0),
    ]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(_make_pdf_page(blocks))):
        result = strategy.extract("dummy.pdf")
        assert result.text == "Heading touching header band\nParagraph touching footer band"

def test_extract_pdf_all_blocks_filtered_returns_empty_string():
    blocks = [(0, 10, 300, 30, "Only a header", 0, 0)]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(_make_pdf_page(blocks))):
        result = strategy.extract("dummy.pdf")
        assert result.text == ""

def _make_mock_doc(*pages):
    mock_doc = MagicMock()
    mock_doc.__iter__.return_value = list(pages)
    mock_doc.__enter__.return_value = mock_doc
    mock_doc.page_count = len(pages)
    return mock_doc

def test_extract_pdf_drops_lines_repeated_on_ratio_of_pages():
    page1 = _make_pdf_page([(0, 100, 500, 150, "Quarterly report\nConfidential", 0, 0)])
    page2 = _make_pdf_page([(0, 100, 500, 150, "Confidential\nQ3 figures", 0, 0)])
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(page1, page2)):
        result = strategy.extract("dummy.pdf")
        assert result.text == "Quarterly report\nQ3 figures"

def test_extract_pdf_keeps_line_below_repetition_threshold():
    blocks1 = [(0, 100, 500, 150, "Intro", 0, 0)]
    blocks2 = [(0, 100, 500, 150, "Methods", 0, 0)]
    blocks3 = [(0, 100, 500, 150, "Intro again", 0, 0), (0, 200, 500, 250, "Shared banner", 1, 0)]
    pages = [_make_pdf_page(b) for b in (blocks1, blocks2, blocks3)]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(*pages)):
        result = strategy.extract("dummy.pdf")
        assert result.text == "Intro\nMethods\nIntro again\nShared banner"

def test_extract_pdf_single_page_never_filtered():
    blocks = [(0, 100, 500, 150, "Only page", 0, 0)]
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(_make_pdf_page(blocks))):
        result = strategy.extract("dummy.pdf")
        assert result.text == "Only page"

def test_extract_pdf_repetition_matching_ignores_whitespace():
    page1 = _make_pdf_page([(0, 100, 500, 150, "Chapter  one", 0, 0)])
    page2 = _make_pdf_page([(0, 100, 500, 150, "Chapter\tone", 0, 0)])
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(page1, page2)):
        result = strategy.extract("dummy.pdf")
        assert result.text == ""

def test_extract_pdf_recovers_pages_before_corrupt_page():
    readable_page = _make_pdf_page([(0, 100, 500, 150, "Readable page", 0, 0)])
    corrupt_page = MagicMock()
    corrupt_page.get_text.side_effect = Exception("broken xref")
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(readable_page, corrupt_page)):
        result = strategy.extract("dummy.pdf")

    assert result.text == "Readable page"
    assert result.truncated is True

def test_extract_pdf_raises_when_every_page_is_corrupt():
    corrupt_page_a = MagicMock()
    corrupt_page_a.get_text.side_effect = Exception("broken a")
    corrupt_page_b = MagicMock()
    corrupt_page_b.get_text.side_effect = Exception("broken b")
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", return_value=_make_mock_doc(corrupt_page_a, corrupt_page_b)):
        with pytest.raises(ExtractionError) as exc_info:
            strategy.extract("dummy.pdf")

    assert "all 2 pages unreadable" in str(exc_info.value)

def test_extract_docx_success():
    p1 = MagicMock(text="Para 1")
    mock_doc = MagicMock(paragraphs=[p1])

    strategy = DocxExtractionStrategy()
    with patch.object(DocxExtractionStrategy, "_guard_uncompressed_size"), \
            patch("docx.Document", return_value=mock_doc):
        result = strategy.extract("dummy.docx")
        assert result.text == "Para 1"

def test_extract_docx_strips_field_chars_and_tabs():
    p1 = MagicMock(text="Before \x13field\x14 result \x15 after\tvalue")
    mock_doc = MagicMock(paragraphs=[p1])

    strategy = DocxExtractionStrategy()
    with patch.object(DocxExtractionStrategy, "_guard_uncompressed_size"), \
            patch("docx.Document", return_value=mock_doc):
        result = strategy.extract("dummy.docx")
        assert result.text == "Before field result  after value"

def test_extract_docx_skips_paragraph_empty_after_cleanup():
    p_field_only = MagicMock(text="\x13\x14\x15")
    p_real = MagicMock(text="Real content")
    mock_doc = MagicMock(paragraphs=[p_field_only, p_real])

    strategy = DocxExtractionStrategy()
    with patch.object(DocxExtractionStrategy, "_guard_uncompressed_size"), \
            patch("docx.Document", return_value=mock_doc):
        result = strategy.extract("dummy.docx")
        assert result.text == "Real content"

def test_extract_txt_utf8():
    strategy = TxtExtractionStrategy()
    with patch("builtins.open", MagicMock(return_value=MagicMock(__enter__=lambda s: MagicMock(read=lambda: b"Hello World")))):
        result = strategy.extract("dummy.txt")
        assert result.text == "Hello World"

def test_extract_txt_latin1():
    strategy = TxtExtractionStrategy()
    with patch("builtins.open", MagicMock(return_value=MagicMock(__enter__=lambda s: MagicMock(read=lambda: b"Caf\xe9")))):
        result = strategy.extract("dummy.txt")
        assert result.text == "Café"

def test_extract_txt_strips_utf8_bom():
    strategy = TxtExtractionStrategy()
    with patch("builtins.open", MagicMock(return_value=MagicMock(__enter__=lambda s: MagicMock(read=lambda: b"\xef\xbb\xbfHello World")))):
        result = strategy.extract("dummy.txt")
        assert result.text == "Hello World"

def test_extract_txt_strips_bom_on_latin1_fallback():
    strategy = TxtExtractionStrategy()
    with patch("builtins.open", MagicMock(return_value=MagicMock(__enter__=lambda s: MagicMock(read=lambda: b"\xef\xbb\xbfCaf\xe9\xfd")))):
        result = strategy.extract("dummy.txt")
        assert result.text == "Caféý"

def test_extract_txt_exception():
    strategy = TxtExtractionStrategy()
    with patch("builtins.open", side_effect=Exception("File not found")):
        with pytest.raises(ExtractionError) as exc_info:
            strategy.extract("dummy.txt")
        assert "Text decoding failed" in str(exc_info.value)

def test_extract_pdf_exception():
    strategy = PdfExtractionStrategy()
    with patch("fitz.open", side_effect=Exception("Corrupted PDF")):
        with pytest.raises(ExtractionError) as exc_info:
            strategy.extract("dummy.pdf")
        assert "PDF processing failed" in str(exc_info.value)

def test_extract_docx_exception():
    strategy = DocxExtractionStrategy()
    with patch.object(DocxExtractionStrategy, "_guard_uncompressed_size"), \
            patch("docx.Document", side_effect=Exception("Corrupted DOCX")):
        with pytest.raises(ExtractionError) as exc_info:
            strategy.extract("dummy.docx")
        assert "DOCX processing failed" in str(exc_info.value)
        assert "Corrupted DOCX" in str(exc_info.value)

def test_factory_returns_correct_strategy():
    assert isinstance(ExtractorFactory.get_strategy("application/pdf"), PdfExtractionStrategy)
    assert isinstance(ExtractorFactory.get_strategy("text/plain"), TxtExtractionStrategy)

def test_factory_raises_on_unknown_mime():
    with pytest.raises(ExtractionError):
        ExtractorFactory.get_strategy("image/png")
