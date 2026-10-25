"""DOCX extraction: the zip's single body part, streamed, not loaded."""

from ..models import Deadline
from .base import DocumentExtractionStrategy


class DocxExtractionStrategy(DocumentExtractionStrategy):
    """Extracts the body paragraphs of an admitted docx.

    The destination (extraction.md): stdlib zipfile opens the bounded
    bytes and ElementTree.iterparse streams word/document.xml from the
    member — no python-docx — emitting body paragraphs only. Headers,
    footers, and footnotes live in separate parts that are never read,
    legacy field-char remnants (U+0013–U+0015) are stripped in the walk
    (cleaning.md phase 1), expired() is checked between member elements,
    and a body part with no paragraphs is a valid empty result — the
    eventual response keeps its text_length 0.
    """

    def extract(self, data: bytes, deadline: Deadline) -> list[str]:
        """Raw ordered lines from the body part's paragraphs."""
        raise NotImplementedError("the docx body walk is not built yet")
