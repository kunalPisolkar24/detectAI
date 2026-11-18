"""The wire boundary: the contract's units, the model key, and the coalescing."""

import pytest

from app.inference.analysis import AnalysisFinished, AnalysisProgress, AnalysisStarted
from app.inference.postprocessing import DocumentVerdict, HighlightSpan
from app.serving.mapper import (
    DEFAULT_MODEL_ID,
    normalize_model_id,
    should_send_progress,
    to_detection_result,
    to_progress_event,
    to_result_event,
    to_started_event,
)


def _verdict(ai: float, is_ai: bool = True) -> DocumentVerdict:
    return DocumentVerdict(
        is_ai_generated=is_ai,
        ai_probability=ai,
        human_probability=1.0 - ai,
        spans=(HighlightSpan(char_start=0, char_end=10, ai_probability=ai),),
    )


def test_an_empty_model_id_falls_back_to_the_default() -> None:
    assert normalize_model_id("") == DEFAULT_MODEL_ID
    assert normalize_model_id("   ") == DEFAULT_MODEL_ID


def test_a_model_id_is_folded_to_its_canonical_key() -> None:
    assert normalize_model_id("flare") == "flare"
    assert normalize_model_id("  SPARK  ") == "spark"


def test_the_confidences_are_percentages_and_not_probabilities() -> None:
    result = to_detection_result("spark", _verdict(0.98765))

    # The contract's fields are 32-bit floats, so the comparison is a close one.
    assert result.ai_confidence == pytest.approx(98.8, abs=1e-4)
    assert result.human_confidence == pytest.approx(1.2, abs=1e-4)


def test_the_confidence_mirrors_the_winning_side() -> None:
    ai = to_detection_result("spark", _verdict(0.8, is_ai=True))
    human = to_detection_result("spark", _verdict(0.2, is_ai=False))

    assert ai.confidence_score == ai.ai_confidence
    assert human.confidence_score == human.human_confidence


def test_the_result_echoes_the_model_id_and_its_spans() -> None:
    result = to_detection_result("flare", _verdict(0.5))

    assert result.model_id == "flare"
    assert result.is_ai_generated is True
    assert len(result.highlight_spans) == 1
    assert result.highlight_spans[0].char_start == 0
    assert result.highlight_spans[0].char_end == 10
    assert result.highlight_spans[0].ai_confidence == 50.0


def test_the_events_carry_their_own_shape() -> None:
    started = to_started_event(AnalysisStarted(total_chars=120, total_chunks=3))
    progress = to_progress_event(AnalysisProgress(processed_chunks=2, total_chunks=3))
    result = to_result_event("spark", AnalysisFinished(verdict=_verdict(0.5)))

    assert started.started.total_chars == 120
    assert started.started.total_chunks == 3
    assert progress.progress.processed_chunks == 2
    assert progress.progress.total_chunks == 3
    assert result.result.model_id == "spark"


@pytest.mark.parametrize(
    ("processed", "total", "last_sent", "expected"),
    [
        (10, 100, 0, True),
        (4, 100, 0, False),
        (5, 100, 0, True),
        (10, 100, 10, False),
        (100, 100, 0, True),
        (100, 100, 90, True),
        (1, 10, 0, True),
    ],
)
def test_the_progress_is_coalesced_to_a_twentieth_of_the_document(
    processed: int, total: int, last_sent: int, expected: bool
) -> None:
    event = AnalysisProgress(processed_chunks=processed, total_chunks=total)

    assert should_send_progress(event, last_sent) is expected
