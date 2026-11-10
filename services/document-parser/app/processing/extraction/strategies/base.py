"""The extraction seam: raw ordered lines, cleaning owned elsewhere.

Cleaning and the cap never run in a strategy; phase-1 suppression does,
because header and folio deletion needs the parser's structure.
"""

from abc import ABC, abstractmethod

from ..models import Deadline, RawLines


class DocumentExtractionStrategy(ABC):
    @abstractmethod
    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        """RawLines for the admitted bytes."""
