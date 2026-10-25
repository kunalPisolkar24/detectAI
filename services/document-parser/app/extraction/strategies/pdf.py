"""PDF extraction: pymupdf v2's ordered blocks, rules (a)/(b) in the walk."""

from ..models import Deadline
from .base import DocumentExtractionStrategy


class PdfExtractionStrategy(DocumentExtractionStrategy):
    """Extracts the ordered text of an admitted pdf.

    The destination (extraction.md): pymupdf v2 — pinned ^2.0, imported
    as pymupdf, never the legacy fitz alias — opens the bounded bytes in
    a context manager (MuPDF holds C-land buffers the GC does not
    manage) and walks the ordered blocks with coordinates. Phase-1 rules
    (a) (position-consistent repetition) and (b) (edge-zone folio drop)
    run inside the walk (cleaning.md), expired() is checked between
    pages, and a zero-text result is UnreadableDocumentError — a scanned
    pdf is a 422 like any unreadable file (cleaning.md). Admission stays
    pypdf's job; this module never re-sniffs the container.
    """

    def extract(self, data: bytes, deadline: Deadline) -> list[str]:
        """Raw ordered lines from the pdf's text blocks."""
        raise NotImplementedError("the pdf block walk is not built yet")
