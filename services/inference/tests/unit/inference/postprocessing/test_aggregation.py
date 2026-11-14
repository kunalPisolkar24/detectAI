"""The aggregation rule: the weighted mean, the threshold, and the spans."""

from dataclasses import FrozenInstanceError

import pytest

from app.inference.postprocessing import (
    DocumentVerdict,
    HighlightSpan,
    PostprocessingError,
    ScoredRegion,
    VerdictAggregator,
)

_THRESHOLD = 0.5


def _region(scored_tokens: int, ai_probability: float, char_start: int = 0) -> ScoredRegion:
    """One region: a weight, a probability, and a six-characters-per-token span."""
    return ScoredRegion(
        char_start=char_start,
        char_end=char_start + scored_tokens * 6,
        scored_tokens=scored_tokens,
        ai_probability=ai_probability,
    )


def test_the_aggregator_holds_its_explicit_contract() -> None:
    aggregator = VerdictAggregator(0.75)

    assert aggregator._threshold == 0.75


def test_the_aggregate_is_the_weighted_mean_of_the_regions() -> None:
    regions = [_region(510, 0.99), _region(510, 0.98), _region(40, 0.20)]

    verdict = VerdictAggregator(_THRESHOLD).aggregate(regions)

    assert verdict.ai_probability == pytest.approx((504.9 + 499.8 + 8.0) / 1060)


def test_a_light_region_counts_less_than_a_heavy_one() -> None:
    light = _region(10, 0.0)
    heavy = _region(1000, 1.0)

    verdict = VerdictAggregator(_THRESHOLD).aggregate([light, heavy])

    assert verdict.ai_probability == pytest.approx(1000 / 1010)


def test_the_aggregate_carries_no_first_chunk_bias() -> None:
    heavy = _region(1000, 0.9)
    light = _region(10, 0.1)

    first = VerdictAggregator(_THRESHOLD).aggregate([heavy, light])
    second = VerdictAggregator(_THRESHOLD).aggregate([light, heavy])

    assert first.ai_probability == second.ai_probability


def test_the_threshold_is_inclusive() -> None:
    verdict = VerdictAggregator(0.5).aggregate([_region(10, 0.5)])

    assert verdict.is_ai_generated is True


def test_a_probability_below_the_threshold_is_human() -> None:
    verdict = VerdictAggregator(0.5).aggregate([_region(10, 0.49)])

    assert verdict.is_ai_generated is False


def test_the_human_probability_is_the_complement() -> None:
    verdict = VerdictAggregator(_THRESHOLD).aggregate([_region(10, 0.25)])

    assert verdict.human_probability == pytest.approx(1.0 - verdict.ai_probability)


def test_one_span_per_region_carrying_its_own_probability() -> None:
    regions = [_region(10, 0.9, char_start=0), _region(10, 0.2, char_start=60)]

    verdict = VerdictAggregator(_THRESHOLD).aggregate(regions)

    assert verdict.spans == (
        HighlightSpan(char_start=0, char_end=60, ai_probability=0.9),
        HighlightSpan(char_start=60, char_end=120, ai_probability=0.2),
    )


def test_adjacent_regions_are_not_merged() -> None:
    regions = [_region(10, 0.9, char_start=0), _region(10, 0.8, char_start=60)]

    verdict = VerdictAggregator(_THRESHOLD).aggregate(regions)

    assert len(verdict.spans) == 2


def test_the_spans_keep_the_regions_order() -> None:
    regions = [_region(10, 0.9, char_start=0), _region(10, 0.2, char_start=60)]

    verdict = VerdictAggregator(_THRESHOLD).aggregate(regions)

    assert [span.char_start for span in verdict.spans] == [0, 60]


def test_no_regions_is_a_postprocessing_error() -> None:
    with pytest.raises(PostprocessingError, match="no scored regions"):
        VerdictAggregator(_THRESHOLD).aggregate(())


@pytest.mark.parametrize("probability", [1.5, -0.1, float("nan"), float("inf")])
def test_a_probability_outside_the_unit_interval_is_refused(probability: float) -> None:
    with pytest.raises(PostprocessingError, match="not a finite value"):
        VerdictAggregator(_THRESHOLD).aggregate([_region(10, probability)])


def test_a_region_with_no_scored_tokens_is_refused() -> None:
    with pytest.raises(PostprocessingError, match="scored tokens"):
        VerdictAggregator(_THRESHOLD).aggregate([_region(0, 0.9)])


def test_a_region_whose_span_does_not_advance_is_refused() -> None:
    region = ScoredRegion(
        char_start=10,
        char_end=10,
        scored_tokens=10,
        ai_probability=0.9,
    )

    with pytest.raises(PostprocessingError, match="ends at 10"):
        VerdictAggregator(_THRESHOLD).aggregate([region])


@pytest.mark.parametrize("threshold", [-0.1, 1.5, float("nan")])
def test_a_threshold_outside_the_unit_interval_is_refused(threshold: float) -> None:
    with pytest.raises(ValueError, match="must lie in"):
        VerdictAggregator(threshold)


@pytest.mark.parametrize("threshold", ["0.5", None, True])
def test_a_threshold_that_is_not_a_number_is_refused(threshold: object) -> None:
    with pytest.raises(TypeError, match="must be a number"):
        VerdictAggregator(threshold)  # type: ignore[arg-type]


def test_the_results_are_frozen_pure_data() -> None:
    region = _region(10, 0.9)

    with pytest.raises(FrozenInstanceError):
        region.ai_probability = 0.1  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        DocumentVerdict(
            is_ai_generated=True,
            ai_probability=0.9,
            human_probability=0.1,
            spans=(),
        ).is_ai_generated = False  # type: ignore[misc]
