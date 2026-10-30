"""The admission service: first strategy outcome wins, a full decline names the junk."""

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
    def __init__(self, strategies: tuple[DocumentValidationStrategy, ...]) -> None:
        self._strategies = strategies

    @property
    def strategies(self) -> tuple[DocumentValidationStrategy, ...]:
        """The ordered registry; order is load-bearing, so it is observable."""
        return self._strategies

    def validate(self, data: bytes) -> ValidationOutcome:
        for strategy in self._strategies:
            outcome = strategy.validate(data)
            if outcome is not None:
                return outcome
        raise UnsupportedTypeError(f"unsupported document type: {classify_unknown(data)}")


def build_default_service(
    *, max_pdf_pages: int = DEFAULT_MAX_PDF_PAGES, docx_max_uncompressed_bytes: int = DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES
) -> DocumentValidationService:
    return DocumentValidationService(
        strategies=(
            PdfValidationStrategy(max_pages=max_pdf_pages),
            DocxValidationStrategy(max_uncompressed_bytes=docx_max_uncompressed_bytes),
            TextValidationStrategy(),
        )
    )
