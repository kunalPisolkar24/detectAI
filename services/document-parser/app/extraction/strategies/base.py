"""The strategy seam: one contract, a mime-keyed registry, no votes.

extract returns RawLines — the raw ordered lines of one admitted body
plus the partial flag for pages the parser could not read — while
cleaning and the cap never run inside a strategy (extraction.md).
Phase-1 suppression does live here, because header and folio deletion
needs the document structure only the parser knows (cleaning.md). The
registry is keyed on the sniffed MIME the admission gate returns
(validation.md); strategies re-sniff nothing. Supporting a new format
is one strategy module plus one registry entry in service.py (FR-2).
"""

from abc import ABC, abstractmethod

from ..models import Deadline, RawLines


class DocumentExtractionStrategy(ABC):
    """Extracts one admitted body; the registry supplies the format."""

    @abstractmethod
    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        """RawLines for the admitted bytes; the failures are the typed
        verdicts and nothing else (extraction.md)."""
