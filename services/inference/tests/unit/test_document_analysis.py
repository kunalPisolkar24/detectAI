import asyncio

import pytest
from pytest import approx

from src.domain.exceptions import InvalidInputError
from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import ChunkPlanner, RegexTokenChunker
from src.application.services.document_analysis import ConcurrencyDispatcher, DocumentAnalysisService
from src.domain.models import DocumentChunk, DocumentProgress, DocumentScore, DocumentStarted
from src.application.services.validation import InputValidator


class SequencedAsyncEngine:
    def __init__(self, results):
        self._results = list(results)

    async def predict(self, text):
        await asyncio.sleep(0)
        return self._results.pop(0)


class SlowAsyncEngine:
    def __init__(self):
        self.cancelled = 0

    async def predict(self, text):
        try:
            await asyncio.sleep(1)
            return 0.5
        except asyncio.CancelledError:
            self.cancelled += 1
            raise


class FailingAsyncEngine:
    def __init__(self):
        self.cancelled = 0

    async def predict(self, text):
        try:
            if text == "fail":
                await asyncio.sleep(0.05)
                raise RuntimeError("boom")
            await asyncio.sleep(1)
            return 0.5
        except asyncio.CancelledError:
            self.cancelled += 1
            raise


async def collect_events(stream):
    return [event async for event in stream]


def test_chunk_planner_builds_multiple_chunks():
    planner = ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=2, max_global_tokens=100)

    chunks = planner.plan("one two three four five six seven eight")

    assert len(chunks) == 3
    assert chunks[0].token_count == 4
    assert chunks[1].token_count == 4
    assert chunks[2].token_count == 4


def test_chunk_planner_token_bomb_protection():
    planner = ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=2)

    with pytest.raises(InvalidInputError, match="Request exceeds hard limit"):
        planner.plan("one two three four five")


def test_result_aggregator_counts_overlap_once():
    planner = ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=2, max_global_tokens=100)
    chunks = planner.plan("one two three four five six seven eight")

    score = ResultAggregator(2).aggregate(chunks, [0.1, 0.5, 0.9], total_chars=39)

    assert score.ai_probability == approx(0.4)
    assert score.total_chunks == 3
    assert score.total_chars == 39


@pytest.mark.asyncio
async def test_document_analysis_streams_progress_and_final():
    engine = SequencedAsyncEngine([0.2, 0.9])
    service = DocumentAnalysisService(
        engines={"spark": engine},
        planners={"spark": ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=100)},
        validator=InputValidator(1000),
        aggregator=ResultAggregator(4),
        max_inflight_chunks=1,
    )

    events = await collect_events(service.stream("one two three four five six", "spark"))

    assert isinstance(events[0], DocumentStarted)
    assert events[0].total_chunks == 2
    assert isinstance(events[1], DocumentProgress)
    assert events[1].processed_chunks == 1
    assert isinstance(events[2], DocumentProgress)
    assert events[2].processed_chunks == 2
    assert isinstance(events[3], DocumentScore)
    assert events[3].ai_probability == approx((4 * 0.2 + 2 * 0.9) / 6)


@pytest.mark.asyncio
async def test_document_analysis_records_metrics_for_analyze(mocker):
    engine = SequencedAsyncEngine([0.2, 0.9])
    mock_plan = mocker.patch("src.application.services.document_analysis.observe_document_plan")
    mock_processed = mocker.patch("src.application.services.document_analysis.record_document_chunk_processed")
    mock_chunk_started = mocker.patch("src.application.services.document_analysis.track_document_chunk_started")
    mock_chunk_finished = mocker.patch("src.application.services.document_analysis.track_document_chunk_finished")
    service = DocumentAnalysisService(
        engines={"spark": engine},
        planners={"spark": ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=100)},
        validator=InputValidator(1000),
        aggregator=ResultAggregator(4),
        max_inflight_chunks=1,
    )

    result = await service.analyze("one two three four five six", "spark")

    assert result.ai_probability == approx((4 * 0.2 + 2 * 0.9) / 6)
    mock_plan.assert_called_once_with("analyze", "spark", 27, 2)
    assert mock_processed.call_count == 2
    assert mock_chunk_started.call_count == 2
    assert mock_chunk_finished.call_count == 2


@pytest.mark.asyncio
async def test_document_analysis_records_metrics_for_stream(mocker):
    engine = SequencedAsyncEngine([0.2, 0.9])
    mock_plan = mocker.patch("src.application.services.document_analysis.observe_document_plan")
    mock_processed = mocker.patch("src.application.services.document_analysis.record_document_chunk_processed")
    mock_chunk_started = mocker.patch("src.application.services.document_analysis.track_document_chunk_started")
    mock_chunk_finished = mocker.patch("src.application.services.document_analysis.track_document_chunk_finished")
    service = DocumentAnalysisService(
        engines={"spark": engine},
        planners={"spark": ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=100)},
        validator=InputValidator(1000),
        aggregator=ResultAggregator(4),
        max_inflight_chunks=1,
    )

    await collect_events(service.stream("one two three four five six", "spark"))

    mock_plan.assert_called_once_with("stream", "spark", 27, 2)
    assert mock_processed.call_count == 2
    assert mock_chunk_started.call_count == 2
    assert mock_chunk_finished.call_count == 2


@pytest.mark.asyncio
async def test_dispatcher_cancels_inflight_tasks_when_request_is_inactive():
    engine = SlowAsyncEngine()
    dispatcher = ConcurrencyDispatcher(2)
    request_active = True

    async def stop_request():
        nonlocal request_active
        await asyncio.sleep(0.05)
        request_active = False

    chunks = [
        DocumentChunk(index=0, text="one", token_count=1, char_start=0, char_end=3),
        DocumentChunk(index=1, text="two", token_count=1, char_start=4, char_end=7),
    ]

    asyncio.create_task(stop_request())

    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        async for _ in dispatcher.execute_progressively(
            engine,
            chunks,
            request_is_active=lambda: request_active,
        ):
            pass

    assert engine.cancelled == 2


@pytest.mark.asyncio
async def test_dispatcher_cancels_sibling_tasks_when_one_chunk_fails():
    engine = FailingAsyncEngine()
    dispatcher = ConcurrencyDispatcher(2)
    chunks = [
        DocumentChunk(index=0, text="fail", token_count=1, char_start=0, char_end=4),
        DocumentChunk(index=1, text="slow", token_count=1, char_start=5, char_end=9),
    ]

    with pytest.raises(RuntimeError, match="boom"):
        async for _ in dispatcher.execute_progressively(
            engine,
            chunks,
            request_is_active=lambda: True,
        ):
            pass

    assert engine.cancelled == 1


def test_document_analysis_rejects_sync_engine():
    class SyncEngine:
        def predict(self, text):
            return 0.5

    with pytest.raises(TypeError, match="async predict method"):
        DocumentAnalysisService(
            engines={"spark": SyncEngine()},
            planners={"spark": ChunkPlanner(RegexTokenChunker(), chunk_size=4, stride=4, max_global_tokens=100)},
            validator=InputValidator(1000),
            aggregator=ResultAggregator(4),
            max_inflight_chunks=1,
        )
