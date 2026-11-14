"""The analysis use case: one document in, one verdict out - unary or streamed."""

import asyncio
import logging
from collections.abc import AsyncGenerator, Mapping, Sequence
from dataclasses import dataclass

from .errors import InferenceError, OverloadedError, UnknownModelError
from .postprocessing import DocumentVerdict, ScoredRegion, VerdictAggregator
from .preprocessing import Chunk, PreparedDocument
from .runtime import ModelRuntime

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AnalysisStarted:
    """The document is admitted and windowed: its shape is known."""

    total_chars: int
    total_chunks: int


@dataclass(frozen=True)
class AnalysisProgress:
    """The chunks scored so far."""

    processed_chunks: int
    total_chunks: int


@dataclass(frozen=True)
class AnalysisFinished:
    """The document's verdict."""

    verdict: DocumentVerdict


AnalysisEvent = AnalysisStarted | AnalysisProgress | AnalysisFinished


class DocumentAnalysis:
    """The use case behind both RPCs: prepare, score in batches, aggregate.

    One document at a time occupies one permit per model, and the permit is
    the engine pool's own width - so a saturated model sheds the request
    rather than queueing work that would take minutes to drain.
    """

    def __init__(self, runtimes: Mapping[str, ModelRuntime], threshold: float) -> None:
        self._runtimes = dict(runtimes)
        self._aggregator = VerdictAggregator(threshold)
        self._permits = {
            key: asyncio.Semaphore(runtime.max_inflight)
            for key, runtime in self._runtimes.items()
        }
        self._draining = False

    async def analyze(self, text: str, model_id: str) -> DocumentVerdict:
        """One verdict for one document: the same work the stream reports."""
        verdict: DocumentVerdict | None = None
        events = self.stream(text, model_id)
        try:
            async for event in events:
                if isinstance(event, AnalysisFinished):
                    verdict = event.verdict
        finally:
            # The permit belongs to the stream, and the stream gives it back
            # only when it ends - so it is closed here, not left to a
            # finaliser that may never run.
            await events.aclose()
        if verdict is None:
            raise InferenceError("the analysis ended without a verdict")
        return verdict

    async def stream(self, text: str, model_id: str) -> AsyncGenerator[AnalysisEvent, None]:
        """The document's events: started, progress as the chunks land, then the verdict."""
        runtime = self._runtime_for(model_id)
        permit = self._permits[runtime.key]
        if self._draining:
            raise OverloadedError("the service is draining")
        if permit.locked():
            logger.warning("%s is at capacity; shedding the request", runtime.key)
            raise OverloadedError(f"{runtime.key} is at capacity")
        await permit.acquire()
        try:
            prepared = await self._prepare(runtime, text)
            total = len(prepared.chunks)
            yield AnalysisStarted(total_chars=prepared.total_chars, total_chunks=total)
            regions: list[ScoredRegion] = []
            for offset in range(0, total, runtime.batch_size):
                batch = prepared.chunks[offset : offset + runtime.batch_size]
                probabilities = await self._score(runtime, batch)
                regions.extend(
                    ScoredRegion(
                        char_start=chunk.char_start,
                        char_end=chunk.char_end,
                        scored_tokens=chunk.scored_tokens,
                        ai_probability=probability,
                    )
                    for chunk, probability in zip(batch, probabilities, strict=True)
                )
                yield AnalysisProgress(
                    processed_chunks=offset + len(batch), total_chunks=total
                )
            yield AnalysisFinished(verdict=self._aggregator.aggregate(regions))
        finally:
            permit.release()

    def begin_draining(self) -> None:
        """Stop admitting documents; the ones in flight finish."""
        self._draining = True

    def _runtime_for(self, model_id: str) -> ModelRuntime:
        runtime = self._runtimes.get(model_id)
        if runtime is None:
            raise UnknownModelError(f"unknown model: {model_id}")
        return runtime

    async def _prepare(self, runtime: ModelRuntime, text: str) -> PreparedDocument:
        """The admission and the windowing, off the event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            runtime.preparation_executor, runtime.preprocessor.prepare, text
        )

    async def _score(self, runtime: ModelRuntime, batch: Sequence[Chunk]) -> tuple[float, ...]:
        """One batch of chunks through the engine, off the event loop."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            runtime.engine_executor,
            runtime.engine.score,
            [chunk.token_ids for chunk in batch],
        )
