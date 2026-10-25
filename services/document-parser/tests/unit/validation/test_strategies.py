"""The three admission strategies against bare bytes.

Each table pins both halves of the contract: the outcome for recognized
bytes and None for the neighbours that must fall through to the next
strategy — PDF magic, zip header, and utf-8 decodability (base.py: the
classification is deterministic, never a vote). The strategies open
containers, so admitted rows use built documents and the bound/corrupt
rows use crafted inputs against injected small limits.
"""

import io
import zipfile

import pytest

from app.validation.models import (
    DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_PDF_PAGES,
    CorruptDocumentError,
    TooLargeError,
    ValidationOutcome,
)
from app.validation.strategies import (
    DocxValidationStrategy,
    PdfValidationStrategy,
    TextValidationStrategy,
)
from tests.support.documents import (
    minimal_docx_bytes,
    minimal_pdf_bytes,
    surrogate_zip_bytes,
)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (minimal_pdf_bytes(1), "application/pdf"),
        (minimal_pdf_bytes(3), "application/pdf"),
        (b"PK\x03\x04 word wallpaper swapped over a pdf", None),
        (b"plain text that never asked to be a pdf", None),
        (b"", None),
    ],
)
def test_pdf_admits_the_signature_and_declines_everything_else(body: bytes, expected: str | None) -> None:
    assert PdfValidationStrategy(max_pages=DEFAULT_MAX_PDF_PAGES).validate(body) == _outcome(expected)


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (minimal_docx_bytes(), DOCX_MIME),
        (minimal_docx_bytes({"word/assets/blob.bin": b"y" * 64}), DOCX_MIME),
        (b"%PDF-1.6 renamed past a zip header", None),
        (b"plain text", None),
        (b"\x89PNG\r\n\x1a\n\r\n image bytes", None),
    ],
)
def test_docx_admits_the_zip_header_and_declines_everything_else(body: bytes, expected: str | None) -> None:
    assert DocxValidationStrategy(max_uncompressed_bytes=DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES).validate(
        body
    ) == _outcome(expected)


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b"", "text/plain"),
        (b"plain text", "text/plain"),
        (b"caf\xef\xbb\xbfutf-8 with a BOM", "text/plain"),
        (b"\n\n\t\n", "text/plain"),
        (b"caf\xe9 latin-1 escapes the credential", None),
        (b"\x89PNG\r\n\x1a\n\r\n image bytes", None),
        (b"%PDF-1.7\n\x00\xff junk past the marker never even opens", None),
    ],
)
def test_text_admits_decodable_bytes_and_declines_the_rest(body: bytes, expected: str | None) -> None:
    assert TextValidationStrategy().validate(body) == _outcome(expected)


def test_the_pdf_pages_bound_rejects_before_any_page_is_parsed() -> None:
    with pytest.raises(TooLargeError, match="3-page"):
        PdfValidationStrategy(max_pages=3).validate(minimal_pdf_bytes(4))


def test_the_pdf_pages_bound_admits_at_the_line() -> None:
    bound = 3

    assert PdfValidationStrategy(max_pages=bound).validate(minimal_pdf_bytes(bound)) == _outcome("application/pdf")


def test_branded_pdf_bytes_without_a_container_are_corrupt() -> None:
    for branded_garbage in (b"%PDF-1.7 no container behind the signature", b"%PDF-"):
        with pytest.raises(CorruptDocumentError, match="did not open"):
            PdfValidationStrategy(max_pages=DEFAULT_MAX_PDF_PAGES).validate(branded_garbage)


def test_the_docx_size_bound_rejects_before_a_content_byte_is_read() -> None:
    document = minimal_docx_bytes({"word/assets/blob.bin": b"z" * 2_000})

    with pytest.raises(TooLargeError, match="1000-byte"):
        DocxValidationStrategy(max_uncompressed_bytes=1_000).validate(document)


def test_the_docx_size_bound_admits_at_the_line() -> None:
    document = minimal_docx_bytes({"word/assets/blob.bin": b"z" * 16})
    uncompressed = sum(info.file_size for info in zipfile.ZipFile(io.BytesIO(document)).infolist())

    assert DocxValidationStrategy(max_uncompressed_bytes=uncompressed).validate(document) == _outcome(DOCX_MIME)


def test_pk_bytes_that_cannot_open_as_a_zip_are_corrupt() -> None:
    with pytest.raises(CorruptDocumentError, match="did not open"):
        DocxValidationStrategy(
            max_uncompressed_bytes=DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES
        ).validate(b"PK\x03\x04 prose")


def test_a_zip_without_the_document_part_is_not_a_document() -> None:
    impostor = surrogate_zip_bytes(["ppt/presentation.xml", "docProps/core.xml"])

    with pytest.raises(CorruptDocumentError, match="no document body"):
        DocxValidationStrategy(max_uncompressed_bytes=DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES).validate(impostor)


def _outcome(expected: str | None) -> ValidationOutcome | None:
    return None if expected is None else ValidationOutcome(mime=expected)
