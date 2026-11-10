"""The admitted pipeline in one call: admission, extraction, verdict recordings."""

import time
from dataclasses import dataclass

# The seam contract, not the package init: its factory imports config, and
# config imports this pipeline's model defaults — the cycle would close here.
from ..observability.contract import Observability
from .extraction import (
    BudgetExhaustedError,
    DocumentExtractionService,
    UnreadableDocumentError,
)
from .validation import (
    CorruptDocumentError,
    DocumentValidationService,
    TooLargeError,
    UnsupportedTypeError,
)


@dataclass(frozen=True, slots=True)
class ProcessedDocument:
    """The admitted pipeline's product: the sniffed MIME plus the extract."""

    mime: str
    text: str
    truncated: bool


class DocumentProcessingService:
    """Runs admission then extraction for one upload, folding each verdict onto the seam."""

    def __init__(
        self,
        validation: DocumentValidationService,
        extraction: DocumentExtractionService,
        observability: Observability,
    ) -> None:
        self._validation = validation
        self._extraction = extraction
        self._observability = observability

    def process(self, document: bytes) -> ProcessedDocument:
        """A typed verdict both folds onto the seam and stops the pipeline; the route maps it onto HTTP."""
        mime = self._admit(document)
        started = time.perf_counter()
        with self._observability.track_extraction(mime, len(document)):
            try:
                result = self._extraction.extract(document, mime)
            except BudgetExhaustedError:
                self._observability.record_extraction(
                    mime, "timeout", time.perf_counter() - started
                )
                raise
            except UnreadableDocumentError:
                self._observability.record_extraction(
                    mime, "unreadable", time.perf_counter() - started
                )
                raise
            self._observability.record_extraction(
                mime,
                "truncated" if result.truncated else "ok",
                time.perf_counter() - started,
            )
        return ProcessedDocument(mime=mime, text=result.text, truncated=result.truncated)

    def _admit(self, document: bytes) -> str:
        try:
            outcome = self._validation.validate(document)
        except UnsupportedTypeError:
            self._observability.record_rejection("unsupported_type")
            raise
        except TooLargeError:
            self._observability.record_rejection("too_large")
            raise
        except CorruptDocumentError:
            self._observability.record_rejection("corrupt")
            raise
        return outcome.mime
