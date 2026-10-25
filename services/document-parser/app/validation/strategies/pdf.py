"""PDF admission."""

from ..models import ValidationOutcome
from .base import DocumentValidationStrategy

_PDF_MIME = "application/pdf"
_PDF_SIGNATURE = b"%PDF-"


class PdfValidationStrategy(DocumentValidationStrategy):
    """Admits uploads carrying the PDF file signature."""

    def validate(self, data: bytes) -> ValidationOutcome | None:
        if data.startswith(_PDF_SIGNATURE):
            return ValidationOutcome(mime=_PDF_MIME)
        return None
