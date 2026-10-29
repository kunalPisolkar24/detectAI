"""The admission vocabulary: canonical sniffs, typed rejections, bound defaults."""

from dataclasses import dataclass

# Numeric bound safe defaults; the whys live in requirements.md.
DEFAULT_UPLOAD_LIMIT_BYTES = 3 * 1024 * 1024
DEFAULT_MAX_PDF_PAGES = 1_000
DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES = 30 * 1024 * 1024

# Canonical MIME vocabulary; the registry keys on it verbatim (http.md decision 4).
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
TEXT_MIME = "text/plain"


@dataclass(frozen=True, slots=True)
class ValidationOutcome:
    """The sniffed canonical MIME; declared Content-Type and filename never vote."""

    mime: str


class UnsupportedTypeError(Exception):
    """No strategy claimed the body; the detail names the sniffed MIME."""


class TooLargeError(Exception):
    """Overstated a bound; the message names the limit for the 413 detail."""


class CorruptDocumentError(Exception):
    """Recognized container that will not open; the 422 stays generic — nothing to brand."""
