"""PDF admission: the signature to claim it, the container to trust it."""

import io

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from ..models import PDF_MIME, CorruptDocumentError, TooLargeError, ValidationOutcome
from .base import DocumentValidationStrategy

_PDF_SIGNATURE = b"%PDF-"


class PdfValidationStrategy(DocumentValidationStrategy):
    def __init__(self, max_pages: int) -> None:
        self._max_pages = max_pages

    def validate(self, data: bytes) -> ValidationOutcome | None:
        if not data.startswith(_PDF_SIGNATURE):
            return None
        try:
            page_count = len(PdfReader(io.BytesIO(data)).pages)
        except PdfReadError as error:
            raise CorruptDocumentError("the pdf container did not open") from error
        if page_count > self._max_pages:
            raise TooLargeError(f"the pdf exceeds the {self._max_pages}-page limit")
        return ValidationOutcome(mime=PDF_MIME)
