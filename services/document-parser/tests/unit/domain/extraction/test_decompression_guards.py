from unittest.mock import MagicMock, patch

import fitz
import pytest

from app.core.exceptions import DocumentTooLargeError, ExtractionError
from app.domain.extraction.strategies import DocxExtractionStrategy, PdfExtractionStrategy


def test_pdf_rejects_documents_over_page_limit(tmp_path, mocker):
    import app.domain.extraction.strategies as strategies_module

    mocker.patch.object(strategies_module.settings, "MAX_PDF_PAGES", 10)
    pdf = tmp_path / "many-pages.pdf"
    with fitz.open() as doc:
        for _ in range(11):
            doc.new_page()
        doc.save(pdf)

    with pytest.raises(DocumentTooLargeError) as exc_info:
        PdfExtractionStrategy().extract(str(pdf))

    assert "exceeds limit" in str(exc_info.value)


def test_pdf_accepts_documents_at_page_limit(tmp_path, mocker):
    import app.domain.extraction.strategies as strategies_module

    mocker.patch.object(strategies_module.settings, "MAX_PDF_PAGES", 10)
    pdf = tmp_path / "ten-pages.pdf"
    with fitz.open() as doc:
        for _ in range(10):
            doc.new_page()
        doc.save(pdf)

    result = PdfExtractionStrategy().extract(str(pdf))

    assert result.truncated is False


def _mock_zip_archive(mocker, member_sizes):
    mock_members = [MagicMock(file_size=size) for size in member_sizes]
    mock_archive = MagicMock()
    mock_archive.__enter__.return_value.infolist.return_value = mock_members
    mocker.patch(
        "app.domain.extraction.strategies.zipfile.ZipFile",
        return_value=mock_archive,
    )
    return mock_archive


def test_docx_rejects_archives_over_uncompressed_limit(mocker):
    _mock_zip_archive(mocker, [60 * 1024 * 1024, 50 * 1024 * 1024])

    with pytest.raises(DocumentTooLargeError) as exc_info:
        DocxExtractionStrategy().extract("bomb.docx")

    assert "exceeds limit" in str(exc_info.value)


def test_docx_accepts_archives_under_uncompressed_limit(mocker):
    _mock_zip_archive(mocker, [1024, 2048])
    mock_doc = MagicMock(paragraphs=[])
    with patch("docx.Document", return_value=mock_doc):
        result = DocxExtractionStrategy().extract("small.docx")

    assert result.text == ""


def test_docx_non_zip_input_raises_extraction_error(tmp_path):
    garbage = tmp_path / "not-a-docx.docx"
    garbage.write_bytes(b"this is not a zip archive")

    with pytest.raises(ExtractionError) as exc_info:
        DocxExtractionStrategy().extract(str(garbage))

    assert "DOCX processing failed" in str(exc_info.value)
