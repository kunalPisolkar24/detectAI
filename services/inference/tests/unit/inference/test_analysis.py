"""The analysis use case: one document in, one verdict out, unary or streamed."""

import asyncio
import logging
import threading
from collections.abc import Iterator

import pytest

from app.inference.analysis import (
    AnalysisFinished,
    AnalysisProgress,
    AnalysisStarted,
    DocumentAnalysis,
)
from app.inference.errors import OverloadedError, UnknownModelError
from app.inference.preprocessing import DocumentPreprocessor, Encoding, InvalidDocument
from app.inference.runtime import ModelRuntime, build_runtime
from app.observability import NullObservability
from tests.support.observability import RecordingObservability

# The pinned artifact identity the runtime carries into the span.
_REVISION = "b0ab87257cc240d66622c2482270ec726e16c553"


class StubTokenizer:
    """Satisfies the Tokenizer port: the attributes and the one call preparation reads."""

    cls_token_id = 50281
    sep_token_id = 50282
    pad_token_id = 50283
    special_token_count = 2

    def encode(self, text: str) -> Encoding:
        """One token per word, the space before a word inside its span."""
        offsets: list[tuple[int, int]] = []
        ids: list[int] = []
        cursor = 0
        for index, word in enumerate(text.split()):
            end = cursor + len(word) + (1 if index else 0)
            offsets.append((cursor, end))
            ids.append(1000 + index)
            cursor = end
        return Encoding(ids=tuple(ids), offsets=tuple(offsets))


class StubEngine:
    """Scores every chunk alike, and records the batches it was handed."""

    def __init__(self, probability: float = 0.75) -> None:
        self._probability = probability
        self.batches: list[list[list[int]]] = []
        self.threads: list[str] = []

    def score(self, sequences: list[list[int]]) -> tuple[float, ...]:
        self.batches.append([list(sequence) for sequence in sequences])
        self.threads.append(threading.current_thread().name)
        return tuple(self._probability for _ in sequences)

    def warmup(self, sequence_length: int) -> None:
        return None


class BlockingEngine(StubEngine):
    """Holds the engine until the test releases it."""

    def __init__(self) -> None:
        super().__init__()
        self.entered = threading.Event()
        self.release = threading.Event()

    def score(self, sequences: list[list[int]]) -> tuple[float, ...]:
        self.entered.set()
        self.release.wait(timeout=5)
        return super().score(sequences)


def _runtime(engine: StubEngine, batch_size: int = 4, max_inflight: int = 2) -> ModelRuntime:
    preprocessor = DocumentPreprocessor(
        tokenizer=StubTokenizer(),
        chunk_token_limit=64,
        model_max_sequence_length=512,
        max_text_chars=1_000_000,
    )
    return build_runtime(
        key="spark",
        preprocessor=preprocessor,
        engine=engine,
        batch_size=batch_size,
        max_inflight=max_inflight,
        revision=_REVISION,
        providers=("CUDAExecutionProvider", "CPUExecutionProvider"),
    )


def _analysis(engine: StubEngine, batch_size: int = 4, max_inflight: int = 2) -> DocumentAnalysis:
    return DocumentAnalysis(
        {"spark": _runtime(engine, batch_size=batch_size, max_inflight=max_inflight)},
        threshold=0.5,
        observability=NullObservability(),
    )


@pytest.fixture
def runtime() -> Iterator[ModelRuntime]:
    built = _runtime(StubEngine())
    yield built
    built.preparation_executor.shutdown(wait=False)
    built.engine_executor.shutdown(wait=False)


def _text(words: int) -> str:
    return " ".join(f"word{index}" for index in range(words))


# The window is 64 tokens wide at the minimum, so a chunk carries 62 of them:
# 130 words are three chunks, 62 + 62 + 6.
_CHUNKS = 3
_LONG = _text(130)


def test_analyze_returns_the_aggregated_verdict() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine(probability=0.75))

        verdict = await analysis.analyze(_text(10), "spark")

        assert verdict.is_ai_generated is True
        assert verdict.ai_probability == 0.75
        assert verdict.human_probability == 0.25
        assert len(verdict.spans) == 1

    asyncio.run(scenario())


def test_the_stream_reports_started_progress_and_the_verdict() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine(), batch_size=2)

        events = [event async for event in analysis.stream(_LONG, "spark")]

        assert isinstance(events[0], AnalysisStarted)
        assert isinstance(events[-1], AnalysisFinished)
        progress = [event for event in events if isinstance(event, AnalysisProgress)]
        assert all(isinstance(event, AnalysisProgress) for event in events[1:-1])
        assert [event.processed_chunks for event in progress] == [2, 3]

    asyncio.run(scenario())


def test_the_started_event_carries_the_document_shape() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine())

        events = [event async for event in analysis.stream(_LONG, "spark")]

        started = events[0]
        assert isinstance(started, AnalysisStarted)
        assert started.total_chars == len(_LONG)
        assert started.total_chunks == _CHUNKS

    asyncio.run(scenario())


def test_the_unary_and_the_streamed_verdict_are_the_same() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine(probability=0.42))

        unary = await analysis.analyze(_LONG, "spark")
        streamed = [event async for event in analysis.stream(_LONG, "spark")]

        assert isinstance(streamed[-1], AnalysisFinished)
        assert streamed[-1].verdict == unary

    asyncio.run(scenario())


def test_the_chunks_are_handed_to_the_engine_in_batches() -> None:
    async def scenario() -> None:
        engine = StubEngine()
        analysis = _analysis(engine, batch_size=2)

        await analysis.analyze(_LONG, "spark")

        assert [len(batch) for batch in engine.batches] == [2, 1]

    asyncio.run(scenario())


def test_the_engine_never_runs_on_the_event_loop() -> None:
    async def scenario() -> None:
        engine = StubEngine()
        analysis = _analysis(engine)

        await analysis.analyze(_text(10), "spark")

        assert engine.threads and all(
            name != threading.current_thread().name for name in engine.threads
        )

    asyncio.run(scenario())


def test_an_unknown_model_is_refused() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine())

        with pytest.raises(UnknownModelError):
            await analysis.analyze(_text(10), "nope")

    asyncio.run(scenario())


def test_an_unanalysable_submission_is_refused() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine())

        with pytest.raises(InvalidDocument):
            await analysis.analyze("   ", "spark")

    asyncio.run(scenario())


def test_a_saturated_model_sheds_the_request() -> None:
    async def scenario() -> None:
        engine = BlockingEngine()
        analysis = _analysis(engine, max_inflight=1)
        first = asyncio.create_task(analysis.analyze(_text(10), "spark"))
        for _ in range(200):
            if engine.entered.is_set():
                break
            await asyncio.sleep(0.01)

        with pytest.raises(OverloadedError):
            await analysis.analyze(_text(10), "spark")

        engine.release.set()
        await first

    asyncio.run(scenario())


def test_the_permit_is_released_when_the_request_is_done() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine(), max_inflight=1)

        await analysis.analyze(_text(10), "spark")
        await analysis.analyze(_text(10), "spark")

    asyncio.run(scenario())


def test_a_draining_service_sheds_the_request() -> None:
    async def scenario() -> None:
        analysis = _analysis(StubEngine())

        analysis.begin_draining()

        with pytest.raises(OverloadedError):
            await analysis.analyze(_text(10), "spark")

    asyncio.run(scenario())


def _recorded_analysis(
    engine: StubEngine, batch_size: int = 4, max_inflight: int = 2
) -> tuple[DocumentAnalysis, RecordingObservability]:
    recorder = RecordingObservability()
    analysis = DocumentAnalysis(
        {"spark": _runtime(engine, batch_size=batch_size, max_inflight=max_inflight)},
        threshold=0.5,
        observability=recorder,
    )
    return analysis, recorder


def test_the_serving_model_is_folded_onto_the_span() -> None:
    async def scenario() -> None:
        analysis, recorder = _recorded_analysis(StubEngine())

        await analysis.analyze(_text(10), "spark")

        assert recorder.models == [
            ("spark", _REVISION, "CUDAExecutionProvider"),
        ]

    asyncio.run(scenario())


def test_the_document_bracket_opens_and_closes_around_the_request() -> None:
    async def scenario() -> None:
        analysis, recorder = _recorded_analysis(StubEngine())

        await analysis.analyze(_text(10), "spark")

        assert recorder.document_brackets == 1
        assert recorder.open_document_brackets == 0

    asyncio.run(scenario())


def test_every_batch_is_measured_and_reported() -> None:
    async def scenario() -> None:
        analysis, recorder = _recorded_analysis(StubEngine(), batch_size=2)

        await analysis.analyze(_LONG, "spark")

        assert recorder.batches == [2, 1]
        assert recorder.open_batches == 0
        assert [model for model, _ in recorder.engine_durations] == ["spark", "spark"]
        assert all(seconds >= 0 for _, seconds in recorder.engine_durations)

    asyncio.run(scenario())


def test_a_shed_request_says_so_in_a_way_the_alert_can_read(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The alert matches on 'dropped' and 'RESOURCE_EXHAUSTED': the wording is the contract."""

    async def scenario() -> None:
        engine = BlockingEngine()
        analysis = _analysis(engine, max_inflight=1)
        first = asyncio.create_task(analysis.analyze(_text(10), "spark"))
        for _ in range(200):
            if engine.entered.is_set():
                break
            await asyncio.sleep(0.01)

        with pytest.raises(OverloadedError):
            await analysis.analyze(_text(10), "spark")

        engine.release.set()
        await first

    with caplog.at_level(logging.WARNING):
        asyncio.run(scenario())

    assert any(
        "dropped" in message and "RESOURCE_EXHAUSTED" in message
        for message in caplog.messages
    )
