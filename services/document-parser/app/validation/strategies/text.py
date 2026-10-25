"""TXT admission: decodability is the only credential."""

from ..models import ValidationOutcome
from .base import DocumentValidationStrategy


class TextValidationStrategy(DocumentValidationStrategy):
    """Admits plain-text uploads, including the empty body."""

    def validate(self, data: bytes) -> ValidationOutcome | None:
        """TODO: outcome for utf-8-decodable bytes (empty included), None otherwise."""
        raise NotImplementedError
