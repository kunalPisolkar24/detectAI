"""The aggregation rule: the scored regions of a document, in, one verdict out."""

import math
from collections.abc import Sequence

from .errors import PostprocessingError
from .results import DocumentVerdict, HighlightSpan, ScoredRegion


class VerdictAggregator:
    """One rule: the scored regions of a document, in, one verdict out."""

    def __init__(self, threshold: float) -> None:
        if isinstance(threshold, bool) or not isinstance(threshold, (int, float)):
            raise TypeError("the threshold must be a number")
        if not 0.0 <= float(threshold) <= 1.0:
            raise ValueError(f"the threshold is {threshold}; it must lie in [0.0, 1.0]")
        self._threshold = float(threshold)

    def aggregate(self, regions: Sequence[ScoredRegion]) -> DocumentVerdict:
        """The document verdict: the weighted mean of the regions, the flag, and the spans."""
        if not regions:
            raise PostprocessingError("there are no scored regions to aggregate")
        total_weight = 0
        weighted_sum = 0.0
        for region in regions:
            self._guard(region)
            total_weight += region.scored_tokens
            weighted_sum += region.scored_tokens * region.ai_probability
        ai_probability = weighted_sum / total_weight
        return DocumentVerdict(
            is_ai_generated=ai_probability >= self._threshold,
            ai_probability=ai_probability,
            human_probability=1.0 - ai_probability,
            spans=tuple(
                HighlightSpan(
                    char_start=region.char_start,
                    char_end=region.char_end,
                    ai_probability=region.ai_probability,
                )
                for region in regions
            ),
        )

    @staticmethod
    def _guard(region: ScoredRegion) -> None:
        """Refuse a region the rule cannot weigh."""
        probability = region.ai_probability
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise PostprocessingError(
                f"the probability {probability!r} is not a finite value in [0.0, 1.0]"
            )
        if region.scored_tokens <= 0:
            raise PostprocessingError(
                f"the region at {region.char_start} has {region.scored_tokens} scored tokens"
            )
        if region.char_end <= region.char_start:
            raise PostprocessingError(
                f"the region at {region.char_start} ends at {region.char_end}"
            )
