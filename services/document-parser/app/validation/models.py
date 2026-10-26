"""The admission vocabulary shared by every layer.

ValidationOutcome, the canonical sniffs, and the typed rejections are the
vocabulary the strategies return, the service routes, and the extract
endpoint maps onto HTTP. models.py is a leaf on purpose: strategies, the
service, the settings contract, api/, and the extraction registry all
import it, nothing imports back — the dependency direction stays one-way
(outer to inner, never the reverse).

The numeric bound defaults live here too, one source for the settings
fields that resolve them and the strategies that enforce them.
"""

from dataclasses import dataclass

# requirements.md numeric bounds: the safe defaults, consumed by both the
# settings contract and the strategies. The values' why lives in
# requirements.md — Numeric bounds, "Why the numbers moved" (Lambda-sized).
DEFAULT_UPLOAD_LIMIT_BYTES = 3 * 1024 * 1024
DEFAULT_MAX_PDF_PAGES = 1_000
DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024

# The canonical MIME vocabulary admission answers (http.md decision 4: the
# sniff wins over the declared type): the strategies return it, the wire
# names it, and the extraction registry keys on it verbatim — one named
# contract instead of copies held in sync by comment.
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TEXT_MIME = "text/plain"


@dataclass(frozen=True, slots=True)
class ValidationOutcome:
    """One strategy's verdict on a body of bytes.

    mime is the canonical, sniffed content type — the declared Content-Type
    and the filename never get a vote (http.md decision 4). A returned
    outcome means recognized and admitted; None means the bytes belong to
    another type, and hard rejections arrive as exceptions instead of
    fields.
    """

    mime: str


class UnsupportedTypeError(Exception):
    """No strategy claimed the body; the detail names the sniffed MIME."""


class TooLargeError(Exception):
    """An admitted type overstepped one of its numeric bounds; the
    message names the limit so the 413 detail can pass it on (http.md)."""


class CorruptDocumentError(Exception):
    """The bytes carried a recognized container that will not open as a
    document; the 422 stays generic because a corrupt file cannot be
    branded (http.md)."""
