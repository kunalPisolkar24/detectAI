"""The validation seam: outcome or None, never a vote.

TextValidationStrategy registers last — a decodable body would otherwise
claim uploads before the magic-prefixed types get their turn.
"""

from abc import ABC, abstractmethod

from ..models import ValidationOutcome


class DocumentValidationStrategy(ABC):
    @abstractmethod
    def validate(self, data: bytes) -> ValidationOutcome | None:
        """An outcome for recognized bytes, None for a foreign type."""
