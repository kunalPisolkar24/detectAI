"""The postprocessing slice: the aggregation of scored regions into one verdict."""

from .aggregation import VerdictAggregator
from .errors import PostprocessingError
from .results import DocumentVerdict, HighlightSpan, ScoredRegion

__all__ = [
    "DocumentVerdict",
    "HighlightSpan",
    "PostprocessingError",
    "ScoredRegion",
    "VerdictAggregator",
]
