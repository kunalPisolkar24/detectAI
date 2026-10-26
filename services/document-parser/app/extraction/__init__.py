"""Admitted bytes to cleaned, capped text (extraction.md).

strategies/ owns per-format extraction, cleaning.py is the shared
normalizer, models.py is the shared vocabulary and the single source of
the extraction defaults. The package imports no framework and no AWS
client, so the unit suite pins it without booting the app (mk/tests.mk
keeps that boundary hard).
"""

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
