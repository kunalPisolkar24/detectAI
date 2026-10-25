"""TXT extraction: the strict decode is the whole format."""

from ..models import Deadline
from .base import DocumentExtractionStrategy


class TextExtractionStrategy(DocumentExtractionStrategy):
    """Extracts the lines of an admitted plain-text body.

    The destination (extraction.md): one strict UTF-8 decode — the second
    one, because owning the input beats trusting another layer's verdict —
    then splitlines(). A decode failure after admission is
    UnreadableDocumentError: extraction failures are 504 and 422 and
    nothing else. No deadline checks: the decode is a single step, so
    there is nothing between which to abandon. The empty body is valid —
    [] now, text_length 0 on the wire (validation.md).
    """

    def extract(self, data: bytes, deadline: Deadline) -> list[str]:
        """Raw ordered lines of the decoded text."""
        raise NotImplementedError("the strict utf-8 decode is not built yet")
