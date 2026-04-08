from __future__ import annotations

import asyncio
from typing import AsyncGenerator

from src.core.interfaces import IInferenceEngine
from src.inference.aggregation import ResultAggregator
from src.inference.chunking import ChunkPlanner
from src.inference.document_types import DocumentProgress, DocumentScore, DocumentStarted
from src.inference.validation import InputValidator


class DocumentAnalysisService:
    def __init__(
        self,
        engines: dict[str, IInferenceEngine],
        planners: dict[str, ChunkPlanner],
        validator: InputValidator,
        aggregator: ResultAggregator,
        max_inflight_chunks: int,
    ):
        self.engines = engines
        self.planners = planners
        self.validator = validator
        self.aggregator = aggregator
        self.max_inflight_chunks = max(1, max_inflight_chunks)

    async def analyze(self, text: str, model_key: str) -> DocumentScore:
        validated_text, chunks = self._prepare(text, model_key)
        probabilities = await self._predict_probabilities(self._get_engine(model_key), chunks)
        return self.aggregator.aggregate(chunks, probabilities, len(validated_text))

    async def stream(self, text: str, model_key: str) -> AsyncGenerator[DocumentStarted | DocumentProgress | DocumentScore, None]:
        validated_text, chunks = self._prepare(text, model_key)
        engine = self._get_engine(model_key)
        probabilities: list[float] = [0.0] * len(chunks)
        processed_chunks = 0

        yield DocumentStarted(total_chars=len(validated_text), total_chunks=len(chunks))

        async for chunk_index, probability in self._predict_probabilities_with_progress(engine, chunks):
            probabilities[chunk_index] = probability
            processed_chunks += 1
            yield DocumentProgress(processed_chunks=processed_chunks, total_chunks=len(chunks))

        yield self.aggregator.aggregate(chunks, probabilities, len(validated_text))

    def summarize(self, text: str, model_key: str) -> tuple[int, int]:
        validated_text, chunks = self._prepare(text, model_key)
        return len(validated_text), len(chunks)

    async def shutdown(self) -> None:
        for engine in self.engines.values():
            if hasattr(engine, "shutdown"):
                if asyncio.iscoroutinefunction(engine.shutdown):
                    await engine.shutdown()
                else:
                    engine.shutdown()

    def __del__(self) -> None:
        pass

    def _prepare(self, text: str, model_key: str):
        validated_text = self.validator.validate(text)
        planner = self._get_planner(model_key)
        chunks = planner.plan(validated_text)
        if not chunks:
            raise ValueError("No chunks were generated for the provided text")
        return validated_text, chunks

    async def _predict_probabilities(self, engine: IInferenceEngine, chunks) -> list[float]:
        ordered_results = [0.0] * len(chunks)
        async for chunk_index, probability in self._predict_probabilities_with_progress(engine, chunks):
            ordered_results[chunk_index] = probability
        return ordered_results

    async def _predict_probabilities_with_progress(self, engine: IInferenceEngine, chunks):
        pending_futures = {}
        pending_index = 0

        while pending_index < len(chunks) and len(pending_futures) < self.max_inflight_chunks:
            future = asyncio.create_task(engine.predict(chunks[pending_index].text))
            pending_futures[future] = pending_index
            pending_index += 1

        while pending_futures:
            completed, _ = await asyncio.wait(pending_futures.keys(), return_when=asyncio.FIRST_COMPLETED)
            for future in completed:
                chunk_index = pending_futures.pop(future)
                yield chunk_index, float(future.result())

                if pending_index < len(chunks):
                    next_future = asyncio.create_task(engine.predict(chunks[pending_index].text))
                    pending_futures[next_future] = pending_index
                    pending_index += 1

    def _get_engine(self, model_key: str) -> IInferenceEngine:
        if model_key not in self.engines:
            raise ValueError(f"Unknown model key: {model_key}")
        return self.engines[model_key]

    def _get_planner(self, model_key: str) -> ChunkPlanner:
        if model_key not in self.planners:
            raise ValueError(f"Unknown model key: {model_key}")
        return self.planners[model_key]
