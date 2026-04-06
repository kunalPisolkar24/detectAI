import pytest
from pytest import approx

from src.inference.aggregation import ResultAggregator
from src.inference.chunking import ChunkPlanner, RegexTokenChunker
from src.inference.document_analysis import DocumentAnalysisService
from src.inference.document_types import DocumentProgress, DocumentScore, DocumentStarted
from src.inference.validation import InputValidator


def test_chunk_planner_builds_multiple_chunks():
    planner = ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=2, max_global_tokens=100)

    chunks = planner.plan("one two three four five six seven eight")

    assert len(chunks) == 3
    assert chunks[0].token_count == 4
    assert chunks[1].token_count == 4
    assert chunks[2].token_count == 4


def test_chunk_planner_token_bomb_protection():
    from src.core.exceptions import InvalidInputError
    planner = ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=2)
    
    with pytest.raises(InvalidInputError, match="Request exceeds hard limit"):
        planner.plan("one two three four five")


def test_result_aggregator_uses_weighted_mean():
    planner = ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=100)
    chunks = planner.plan("one two three four five six")

    score = ResultAggregator().aggregate(chunks, [0.2, 0.8], total_chars=23)

    assert score.ai_probability == approx(0.4)
    assert score.total_chunks == 2
    assert score.total_chars == 23


def test_document_analysis_streams_progress_and_final(mock_engine):
    mock_engine.predict.side_effect = [0.2, 0.9]

    service = DocumentAnalysisService(
        engines={"spark": mock_engine},
        planners={"spark": ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=100)},
        validator=InputValidator(1000),
        aggregator=ResultAggregator(),
        max_inflight_chunks=1,
    )

    events = list(service.stream("one two three four five six", "spark"))

    assert isinstance(events[0], DocumentStarted)
    assert events[0].total_chunks == 2
    assert isinstance(events[1], DocumentProgress)
    assert events[1].processed_chunks == 1
    assert isinstance(events[2], DocumentProgress)
    assert events[2].processed_chunks == 2
    assert isinstance(events[3], DocumentScore)
    assert events[3].ai_probability == approx((4 * 0.2 + 2 * 0.9) / 6)
