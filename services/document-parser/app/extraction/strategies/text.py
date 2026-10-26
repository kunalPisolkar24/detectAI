"""TXT extraction: the strict decode is the whole format."""

from ..models import Deadline, RawLines, UnreadableDocumentError
from .base import DocumentExtractionStrategy


class TextExtractionStrategy(DocumentExtractionStrategy):
    """Extracts the lines of an admitted plain-text body.

    One strict UTF-8 decode — the second one, because owning the input
    beats trusting another layer's verdict — then splitlines(). A decode
    failure after admission is UnreadableDocumentError: extraction
    failures are 504 and 422 and nothing else. No deadline checks: the
    decode is a single step, so there is nothing between which to
    abandon. The empty body is valid: an empty line list here, and
    text_length 0 on the wire once the route leg lands (validation.md).
    """

    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        """Raw ordered lines of the decoded text."""
        try:
            decoded = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise UnreadableDocumentError("the text body did not decode") from error
        return RawLines(decoded.splitlines(), partial=False)
