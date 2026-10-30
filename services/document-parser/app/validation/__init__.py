"""Upload admission: strategies, shared vocabulary, bound defaults; a leaf package."""

from .models import (
    DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_PDF_PAGES,
    DEFAULT_UPLOAD_LIMIT_BYTES,
    CorruptDocumentError,
    TooLargeError,
    UnsupportedTypeError,
    ValidationOutcome,
)
from .service import DocumentValidationService, build_default_service

__all__ = [
    "DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES",
    "DEFAULT_MAX_PDF_PAGES",
    "DEFAULT_UPLOAD_LIMIT_BYTES",
    "CorruptDocumentError",
    "DocumentValidationService",
    "TooLargeError",
    "UnsupportedTypeError",
    "ValidationOutcome",
    "build_default_service",
]
