"""TXT admission: decodability is the only credential."""

from ..models import ValidationOutcome
from .base import DocumentValidationStrategy

_TEXT_MIME = "text/plain"


class TextValidationStrategy(DocumentValidationStrategy):
    """Admits plain-text uploads, including the empty body."""

    def validate(self, data: bytes) -> ValidationOutcome | None:
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            return None
        return ValidationOutcome(mime=_TEXT_MIME)
