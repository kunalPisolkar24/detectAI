"""TXT extraction: the strict decode is the whole format."""

from ..models import Deadline, RawLines, UnreadableDocumentError
from .base import DocumentExtractionStrategy


class TextExtractionStrategy(DocumentExtractionStrategy):
    """One strict decode, no deadline checks; a decode failure is UnreadableDocumentError."""

    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        try:
            decoded = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise UnreadableDocumentError("the text body did not decode") from error
        return RawLines(decoded.splitlines(), partial=False)
