"""The extraction registry and pipeline: budget, format, cleaning, cap — once each."""

from collections.abc import Mapping

from ..validation.models import DOCX_MIME, PDF_MIME, TEXT_MIME
from .cleaning import normalize
from .models import (
    DEFAULT_OUTPUT_CHAR_LIMIT,
    DEFAULT_PROCESSING_BUDGET_SECONDS,
    CleaningKnobs,
    Deadline,
    ExtractionResult,
    UnreadableDocumentError,
)
from .strategies import (
    DocumentExtractionStrategy,
    DocxExtractionStrategy,
    PdfExtractionStrategy,
    TextExtractionStrategy,
)


class DocumentExtractionService:
    """Runs the pipeline for one admitted body, keyed on the sniffed MIME."""

    def __init__(
        self,
        strategies: Mapping[str, DocumentExtractionStrategy],
        *,
        processing_budget_seconds: float,
        output_char_limit: int,
    ) -> None:
        self._strategies = strategies
        self._processing_budget_seconds = processing_budget_seconds
        self._output_char_limit = output_char_limit

    @property
    def strategies(self) -> Mapping[str, DocumentExtractionStrategy]:
        return self._strategies

    def extract(self, data: bytes, mime: str) -> ExtractionResult:
        """A mime with no strategy is UnreadableDocumentError: gate and registry disagreeing."""
        deadline = Deadline.from_budget(self._processing_budget_seconds)
        strategy = self._strategies.get(mime)
        if strategy is None:
            raise UnreadableDocumentError(f"no extraction strategy claims {mime}")
        outcome = strategy.extract(data, deadline)
        text = normalize(outcome.lines)
        if len(text) > self._output_char_limit:
            return ExtractionResult(text=text[: self._output_char_limit], truncated=True)
        return ExtractionResult(text=text, truncated=outcome.partial)


def build_default_extraction_service(
    *,
    processing_budget_seconds: float = DEFAULT_PROCESSING_BUDGET_SECONDS,
    output_char_limit: int = DEFAULT_OUTPUT_CHAR_LIMIT,
    cleaning_knobs: CleaningKnobs | None = None,
) -> DocumentExtractionService:
    return DocumentExtractionService(
        strategies={
            PDF_MIME: PdfExtractionStrategy(cleaning_knobs or CleaningKnobs()),
            DOCX_MIME: DocxExtractionStrategy(),
            TEXT_MIME: TextExtractionStrategy(),
        },
        processing_budget_seconds=processing_budget_seconds,
        output_char_limit=output_char_limit,
    )
