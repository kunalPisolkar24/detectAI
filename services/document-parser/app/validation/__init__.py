"""Upload admission: the boundary between transport and content judgment.

api/extract.py consumes DocumentValidationService; strategies/ owns
per-type recognition, container checks, and numeric bounds; models.py is
the shared vocabulary and the single source of the bound defaults. The
package imports only its document formats (pypdf for the pdf type) — no
framework, no boto3 — so the unit suite pins it without booting the app
(mk/tests.mk keeps that boundary hard).
"""

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
