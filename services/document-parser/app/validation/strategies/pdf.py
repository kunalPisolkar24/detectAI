"""PDF admission."""

from ..models import ValidationOutcome
from .base import DocumentValidationStrategy


class PdfValidationStrategy(DocumentValidationStrategy):
    """Admits uploads carrying the PDF file signature."""

    def validate(self, data: bytes) -> ValidationOutcome | None:
        """TODO: outcome when the %PDF- signature opens the body, None otherwise."""
        raise NotImplementedError
