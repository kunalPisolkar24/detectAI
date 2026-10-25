"""The strategy seam: one contract, an ordered registry, one winner.

validate returns the outcome for bytes the strategy recognizes and None
for every other type — a deterministic classification, never a vote. The
registry order is part of the contract (http.md decision 4: sniffed MIME
over declared content), and TextValidationStrategy must register last:
any decodable body would otherwise claim the upload before the
magic-prefixed types get their turn. Supporting a new format is one
strategy module here plus one registry entry in service.py (FR-2).
"""

from abc import ABC, abstractmethod

from ..models import ValidationOutcome


class DocumentValidationStrategy(ABC):
    """Judges one upload body; the registry supplies the order."""

    @abstractmethod
    def validate(self, data: bytes) -> ValidationOutcome | None:
        """An outcome for recognized bytes, None for a foreign type."""
