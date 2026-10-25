"""The three admission strategies against bare bytes.

Each table pins both halves of the contract: the outcome for recognized
bytes and None for the neighbours that must fall through to the next
strategy — PDF magic, zip header, and utf-8 decodability (base.py: the
classification is deterministic, never a vote).
"""

import pytest

from app.validation.models import ValidationOutcome
from app.validation.strategies import (
    DocxValidationStrategy,
    PdfValidationStrategy,
    TextValidationStrategy,
)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b"%PDF-1.7\n fake body", "application/pdf"),
        (b"%PDF-", "application/pdf"),
        (b"PK\x03\x04 Word wallpaper swapped over a pdf", None),
        (b"plain text that never asked to be a pdf", None),
        (b"", None),
    ],
)
def test_pdf_admits_the_signature_and_declines_everything_else(body: bytes, expected: str | None) -> None:
    assert PdfValidationStrategy().validate(body) == _outcome(expected)


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b"PK\x03\x04 a plausible docx", DOCX_MIME),
        (b"PK\x03\x04", DOCX_MIME),
        (b"%PDF-1.6 renamed past a zip header", None),
        (b"plain text", None),
        (b"\x89PNG\r\n\x1a\n\r\n image bytes", None),
    ],
)
def test_docx_admits_the_zip_header_and_declines_everything_else(body: bytes, expected: str | None) -> None:
    assert DocxValidationStrategy().validate(body) == _outcome(expected)


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        (b"", "text/plain"),
        (b"plain text", "text/plain"),
        (b"caf\xef\xbb\xbfutf-8 with a BOM", "text/plain"),
        (b"\n\n\t\n", "text/plain"),
        (b"caf\xe9 latin-1 escapes the credential", None),
        (b"\x89PNG\r\n\x1a\n\r\n image bytes", None),
        (b"%PDF-1.7\n\x00\xff junk past the marker", None),
    ],
)
def test_text_admits_decodable_bytes_and_declines_the_rest(body: bytes, expected: str | None) -> None:
    assert TextValidationStrategy().validate(body) == _outcome(expected)


def _outcome(expected: str | None) -> ValidationOutcome | None:
    return None if expected is None else ValidationOutcome(mime=expected)
