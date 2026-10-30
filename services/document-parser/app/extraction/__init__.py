"""Admitted bytes to cleaned, capped text; a framework-free leaf package."""

from .models import (
    DEFAULT_EDGE_TOLERANCE_RATIO,
    DEFAULT_EDGE_ZONE_RATIO,
    DEFAULT_FOLIO_MONOTONIC_RATIO,
    DEFAULT_HEADER_EDGE_ZONE_RATIO,
    DEFAULT_HEADER_REPETITION_RATIO,
    DEFAULT_OUTPUT_CHAR_LIMIT,
    DEFAULT_PROCESSING_BUDGET_SECONDS,
    DEFAULT_REPETITION_MIN_PAGES,
    BudgetExhaustedError,
    CleaningKnobs,
    Deadline,
    ExtractionError,
    ExtractionResult,
    RawLines,
    UnreadableDocumentError,
)
from .service import DocumentExtractionService, build_default_extraction_service

__all__ = [
    "DEFAULT_EDGE_TOLERANCE_RATIO",
    "DEFAULT_EDGE_ZONE_RATIO",
    "DEFAULT_FOLIO_MONOTONIC_RATIO",
    "DEFAULT_HEADER_EDGE_ZONE_RATIO",
    "DEFAULT_HEADER_REPETITION_RATIO",
    "DEFAULT_OUTPUT_CHAR_LIMIT",
    "DEFAULT_PROCESSING_BUDGET_SECONDS",
    "DEFAULT_REPETITION_MIN_PAGES",
    "BudgetExhaustedError",
    "CleaningKnobs",
    "Deadline",
    "DocumentExtractionService",
    "ExtractionError",
    "ExtractionResult",
    "RawLines",
    "UnreadableDocumentError",
    "build_default_extraction_service",
]
