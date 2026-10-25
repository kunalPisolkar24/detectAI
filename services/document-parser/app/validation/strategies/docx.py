"""DOCX admission."""

from ..models import ValidationOutcome
from .base import DocumentValidationStrategy


class DocxValidationStrategy(DocumentValidationStrategy):
    """Admits uploads whose leading bytes are the zip local-file header (PK 03 04)."""

    def validate(self, data: bytes) -> ValidationOutcome | None:
        """TODO: outcome when the zip header opens the body, None otherwise."""
        raise NotImplementedError
