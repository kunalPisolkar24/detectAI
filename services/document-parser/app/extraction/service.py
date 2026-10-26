"""The registry and the pipeline: budget, format, cleaning, cap, once each.

The service owns everything after admission (extraction.md): it computes
the Deadline once from the settings budget, hands the admitted bytes to
the mime-keyed strategy, runs the one cleaning pass over the raw lines,
and enforces the output cap — truncated is set at this single place
(http.md decision 6). Bounds never arrive here: the interior caps were
admission's business (validation.md), so extraction inherits zero
remaining TooLargeError shapes.
"""

from collections.abc import Mapping

from .cleaning import normalize
from .models import (
    DEFAULT_OUTPUT_CHAR_LIMIT,
    DEFAULT_PROCESSING_BUDGET_SECONDS,
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

# The canonical MIME strings the admission gate sniffs (the validation
# strategies); the keys below must stay verbatim to them.
_PDF_MIME = "application/pdf"
_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_TEXT_MIME = "text/plain"


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
        """The mime-keyed registry, observable like the gate's order."""
        return self._strategies

    def extract(self, data: bytes, mime: str) -> ExtractionResult:
        """Budget, format, cleaning, cap — each run once (extraction.md).
        A mime the registry does not key is UnreadableDocumentError: the
        gate and the registry disagreeing leaves content no strategy owns."""
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
) -> DocumentExtractionService:
    """The production registry, keyed on what the gate sniffs: PDF, DOCX,
    then TXT — all three sniffs of the build — carrying the spec-default
    knobs unless the composition root passes resolved settings values."""
    return DocumentExtractionService(
        strategies={
            _PDF_MIME: PdfExtractionStrategy(),
            _DOCX_MIME: DocxExtractionStrategy(),
            _TEXT_MIME: TextExtractionStrategy(),
        },
        processing_budget_seconds=processing_budget_seconds,
        output_char_limit=output_char_limit,
    )
