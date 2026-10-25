"""DOCX admission."""

from ..models import ValidationOutcome
from .base import DocumentValidationStrategy

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_ZIP_LOCAL_FILE_HEADER = b"PK\x03\x04"


class DocxValidationStrategy(DocumentValidationStrategy):
    """Admits uploads whose leading bytes are the zip local-file header (PK 03 04)."""

    def validate(self, data: bytes) -> ValidationOutcome | None:
        if data.startswith(_ZIP_LOCAL_FILE_HEADER):
            return ValidationOutcome(mime=_DOCX_MIME)
        return None
