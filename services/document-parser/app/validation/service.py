"""The registry runner: one ordered pass, one deterministic winner.

The service owns admission: it walks the strategies with the raw body and
stops at the first classification. Size never reaches here — the 3 MiB
body cap is a transport concern, enforced by the bounded read in the
extract endpoint (NFR-4). When no strategy claims the bytes, the decline
turns into UnsupportedTypeError carrying the diagnosed MIME for the 415.
"""

from .diagnosis import classify_unknown
from .models import (
    DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_MAX_PDF_PAGES,
    UnsupportedTypeError,
    ValidationOutcome,
)
from .strategies import (
    DocumentValidationStrategy,
    DocxValidationStrategy,
    PdfValidationStrategy,
    TextValidationStrategy,
)


class DocumentValidationService:
    """Admits one upload body through the ordered strategy registry."""

    def __init__(self, strategies: tuple[DocumentValidationStrategy, ...]) -> None:
        self._strategies = strategies

    @property
    def strategies(self) -> tuple[DocumentValidationStrategy, ...]:
        """The ordered registry; order is load-bearing, so it is observable."""
        return self._strategies

    def validate(self, data: bytes) -> ValidationOutcome:
        """First strategy outcome wins; a full registry decline names the junk."""
        for strategy in self._strategies:
            outcome = strategy.validate(data)
            if outcome is not None:
                return outcome
        raise UnsupportedTypeError(f"unsupported document type: {classify_unknown(data)}")


def build_default_service(
    *, max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES, docx_max_uncompressed_bytes: int = DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES
) -> DocumentValidationService:
    """The production registry: PDF, then DOCX, then TXT — text last by
    contract, each strategy carrying its spec-default bound unless the
    composition root passes resolved settings values."""
    return DocumentValidationService(
        strategies=(
            PdfValidationStrategy(max_pages=max_pdf_pages),
            DocxValidationStrategy(max_uncompressed_bytes=docx_max_uncompressed_bytes),
            TextValidationStrategy(),
        )
    )
