"""The RPC surface: the two shapes the contract names, and its error semantics."""

import asyncio
import threading
from typing import NoReturn

import grpc
import pytest

from app.inference.analysis import DocumentAnalysis
from app.inference.preprocessing import DocumentPreprocessor, Encoding
from app.inference.runtime import build_runtime
from app.serving.generated import ai_service_pb2 as pb
from app.serving.servicer import AIServiceServicer


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
    """Scores every chunk alike."""

    def __init__(self, probability: float = 0.75) -> None:
        self._probability = probability

    def score(self, sequences: list[list[int]]) -> tuple[float, ...]:
        return tuple(self._probability for _ in sequences)

    def warmup(self, sequence_length: int) -> None:
        return None


class FailingEngine(StubEngine):
    """A session that breaks mid-document."""

    def score(self, sequences: list[list[int]]) -> tuple[float, ...]:
        raise RuntimeError("the graph is broken")


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


class Aborted(Exception):
    """The fake context's abort: the RPC ends here."""


class FakeContext:
    """The bits of the servicer context the servicer touches."""

    def __init__(self) -> None:
        self.code: grpc.StatusCode | None = None
        self.detail: str = ""

    async def abort(self, code: grpc.StatusCode, details: str = "") -> NoReturn:
        self.code = code
        self.detail = details
        raise Aborted


def _servicer(
    probability: float = 0.75,
    failing: bool = False,
    max_inflight: int = 2,
    models: tuple[str, ...] = ("spark",),
    engine: StubEngine | None = None,
) -> AIServiceServicer:
    if engine is None:
        engine = FailingEngine() if failing else StubEngine(probability=probability)
    preprocessor = DocumentPreprocessor(
        tokenizer=StubTokenizer(),
        chunk_token_limit=64,
        model_max_sequence_length=512,
        max_text_chars=1_000_000,
    )
    runtimes = {
        key: build_runtime(
            key=key,
            preprocessor=preprocessor,
            engine=engine,
            batch_size=8,
            max_inflight=max_inflight,
        )
        for key in models
    }
    return AIServiceServicer(DocumentAnalysis(runtimes, threshold=0.5))


def _text(words: int) -> str:
    return " ".join(f"word{index}" for index in range(words))


def test_detect_answers_the_verdict() -> None:
    async def scenario() -> None:
        servicer = _servicer(probability=0.75)

        result = await servicer.Detect(pb.DetectRequest(text=_text(10)), FakeContext())

        assert result.model_id == "spark"
        assert result.is_ai_generated is True
        assert result.ai_confidence == 75.0
        assert result.confidence_score == 75.0
        assert len(result.highlight_spans) == 1

    asyncio.run(scenario())


def test_detect_echoes_the_model_it_used() -> None:
    async def scenario() -> None:
        servicer = _servicer(models=("spark", "flare"))

        result = await servicer.Detect(
            pb.DetectRequest(text=_text(10), model_id="flare"), FakeContext()
        )

        assert result.model_id == "flare"

    asyncio.run(scenario())


def test_an_unknown_model_is_refused() -> None:
    async def scenario() -> None:
        servicer = _servicer()
        context = FakeContext()

        with pytest.raises(Aborted):
            await servicer.Detect(
                pb.DetectRequest(text=_text(10), model_id="nope"), context
            )

        assert context.code == grpc.StatusCode.INVALID_ARGUMENT
        assert "nope" in context.detail

    asyncio.run(scenario())


def test_an_empty_submission_is_refused() -> None:
    async def scenario() -> None:
        servicer = _servicer()
        context = FakeContext()

        with pytest.raises(Aborted):
            await servicer.Detect(pb.DetectRequest(text="   "), context)

        assert context.code == grpc.StatusCode.INVALID_ARGUMENT

    asyncio.run(scenario())


def test_a_broken_engine_answers_an_internal_fault_without_the_detail() -> None:
    async def scenario() -> None:
        servicer = _servicer(failing=True)
        context = FakeContext()

        with pytest.raises(Aborted):
            await servicer.Detect(pb.DetectRequest(text=_text(10)), context)

        assert context.code == grpc.StatusCode.INTERNAL
        assert context.detail == "Internal Inference Error"
        assert "broken" not in context.detail

    asyncio.run(scenario())


def test_a_saturated_model_sheds_the_request() -> None:
    async def scenario() -> None:
        engine = BlockingEngine()
        servicer = _servicer(engine=engine, max_inflight=1)
        first = asyncio.create_task(
            servicer.Detect(pb.DetectRequest(text=_text(10)), FakeContext())
        )
        for _ in range(200):
            if engine.entered.is_set():
                break
            await asyncio.sleep(0.01)
        context = FakeContext()

        with pytest.raises(Aborted):
            await servicer.Detect(pb.DetectRequest(text=_text(10)), context)

        assert context.code == grpc.StatusCode.RESOURCE_EXHAUSTED
        engine.release.set()
        await first

    asyncio.run(scenario())


def test_analyze_document_streams_started_progress_and_the_result() -> None:
    async def scenario() -> None:
        servicer = _servicer()

        events = [
            event
            async for event in servicer.AnalyzeDocument(
                pb.AnalyzeDocumentRequest(text=_text(130)), FakeContext()
            )
        ]

        assert events[0].WhichOneof("event") == "started"
        assert events[-1].WhichOneof("event") == "result"
        assert events[-1].result.model_id == "spark"
        assert events[-1].result.ai_confidence == 75.0
        assert all(event.WhichOneof("event") in ("started", "progress", "result") for event in events)

    asyncio.run(scenario())


def test_the_progress_events_stay_under_the_contract_ceiling() -> None:
    async def scenario() -> None:
        servicer = _servicer()

        events = [
            event
            async for event in servicer.AnalyzeDocument(
                pb.AnalyzeDocumentRequest(text=_text(6200)), FakeContext()
            )
        ]

        progress = [event for event in events if event.WhichOneof("event") == "progress"]
        assert 0 < len(progress) <= 20
        assert progress[-1].progress.processed_chunks == progress[-1].progress.total_chunks

    asyncio.run(scenario())


def test_analyze_document_refuses_an_unknown_model() -> None:
    async def scenario() -> None:
        servicer = _servicer()
        context = FakeContext()

        with pytest.raises(Aborted):
            async for _ in servicer.AnalyzeDocument(
                pb.AnalyzeDocumentRequest(text=_text(10), model_id="nope"), context
            ):
                pass

        assert context.code == grpc.StatusCode.INVALID_ARGUMENT

    asyncio.run(scenario())
