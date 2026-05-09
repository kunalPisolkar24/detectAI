from __future__ import annotations

import asyncio
import inspect
from typing import AsyncGenerator, Callable, List, Optional, Tuple

from src.application.ports.outbound.inference import IAsyncInferenceEngine, IEngineHealthReporter
from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import ChunkPlanner
from src.domain.models import DocumentChunk, DocumentProgress, DocumentScore, DocumentStarted
from src.application.services.validation import InputValidator
from src.application.ports.outbound.telemetry import ITelemetryReporter


class TextPreparationPipeline:
    def __init__(self, validator: InputValidator, planners: dict[str, ChunkPlanner]):
        self.validator = validator
        self.planners = planners

    def prepare(self, text: str, model_key: str) -> Tuple[str, List[DocumentChunk]]:
        validated_text = self.validator.validate(text)
        if model_key not in self.planners:
            raise ValueError(f"Unknown model key: {model_key}")
        chunks = self.planners[model_key].plan(validated_text)
        if not chunks:
            raise ValueError("No chunks were generated for the provided text")
        return validated_text, chunks


class ConcurrencyDispatcher:
    def __init__(self, max_inflight: int):
        self.max_inflight = max(1, max_inflight)

    async def execute_progressively(
        self, 
        engine: IAsyncInferenceEngine, 
        chunks: List[DocumentChunk], 
        request_is_active: Optional[Callable[[], bool]] = None,
        operation: str = "analyze",
        model_key: str = "unknown",
        telemetry: ITelemetryReporter = None,
    ) -> AsyncGenerator[Tuple[int, float], None]:
        semaphore = asyncio.Semaphore(self.max_inflight)

        async def _worker(chunk_index: int, chunk: DocumentChunk) -> Tuple[int, float]:
            async with semaphore:
                if request_is_active and not request_is_active():
                    raise asyncio.CancelledError("Client disconnected")
                result = await self._predict_chunk(engine, chunk.text, operation, model_key, telemetry)
                return chunk_index, result

        tasks = [
            asyncio.create_task(_worker(i, chunk))
            for i, chunk in enumerate(chunks)
        ]

        try:
            for future in asyncio.as_completed(tasks):
                yield await future
        except BaseException:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            raise

    async def _predict_chunk(self, engine: IAsyncInferenceEngine, text: str, operation: str, model_key: str, telemetry: ITelemetryReporter) -> float:
        telemetry.track_document_chunk_started(operation, model_key)
        try:
            return float(await engine.predict(text))
        finally:
            telemetry.track_document_chunk_finished(operation, model_key)


class DocumentAnalysisService:
    def __init__(
        self,
        engines: dict[str, IAsyncInferenceEngine],
        planners: dict[str, ChunkPlanner],
        validator: InputValidator,
        aggregator: ResultAggregator,
        max_inflight_chunks: int,
        telemetry: ITelemetryReporter,
        health_reporters: dict[str, IEngineHealthReporter] | None = None,
    ):
        for model_key, engine in engines.items():
            if not inspect.iscoroutinefunction(getattr(engine, "predict", None)):
                raise TypeError(f"Engine '{model_key}' must expose an async predict method")
        self.engines = engines
        self.health_reporters = health_reporters or {}
        self.prep_pipeline = TextPreparationPipeline(validator, planners)
        self.dispatcher = ConcurrencyDispatcher(max_inflight_chunks)
        self.aggregator = aggregator
        self.telemetry = telemetry

    async def analyze(
        self,
        text: str,
        model_key: str,
        request_is_active: Optional[Callable[[], bool]] = None,
    ) -> DocumentScore:
        operation = "analyze"
        validated_text, chunks = self.prep_pipeline.prepare(text, model_key)
        engine = self._get_engine(model_key)
        self.telemetry.observe_document_plan(operation, model_key, len(validated_text), len(chunks))
        
        probabilities = [0.0] * len(chunks)
        async for chunk_index, prob in self.dispatcher.execute_progressively(
            engine,
            chunks,
            request_is_active,
            operation=operation,
            model_key=model_key,
            telemetry=self.telemetry,
        ):
            probabilities[chunk_index] = prob
            self.telemetry.record_document_chunk_processed(operation, model_key)
            
        return self.aggregator.aggregate(chunks, probabilities, len(validated_text))

    async def stream(
        self,
        text: str,
        model_key: str,
        request_is_active: Optional[Callable[[], bool]] = None,
    ) -> AsyncGenerator[DocumentStarted | DocumentProgress | DocumentScore, None]:
        operation = "stream"
        validated_text, chunks = self.prep_pipeline.prepare(text, model_key)
        engine = self._get_engine(model_key)
        self.telemetry.observe_document_plan(operation, model_key, len(validated_text), len(chunks))
        probabilities: list[float] = [0.0] * len(chunks)
        processed_chunks = 0

        yield DocumentStarted(total_chars=len(validated_text), total_chunks=len(chunks))

        async for chunk_index, prob in self.dispatcher.execute_progressively(
            engine,
            chunks,
            request_is_active,
            operation=operation,
            model_key=model_key,
            telemetry=self.telemetry,
        ):
            probabilities[chunk_index] = prob
            self.telemetry.record_document_chunk_processed(operation, model_key)
            processed_chunks += 1
            yield DocumentProgress(processed_chunks=processed_chunks, total_chunks=len(chunks))

        yield self.aggregator.aggregate(chunks, probabilities, len(validated_text))

    def summarize(self, text: str, model_key: str) -> tuple[int, int]:
        validated_text, chunks = self.prep_pipeline.prepare(text, model_key)
        return len(validated_text), len(chunks)

    async def shutdown(self) -> None:
        for engine in self.engines.values():
            if hasattr(engine, "shutdown"):
                if asyncio.iscoroutinefunction(engine.shutdown):
                    await engine.shutdown()
                else:
                    engine.shutdown()

    def _get_engine(self, model_key: str) -> IAsyncInferenceEngine:
        if model_key not in self.engines:
            raise ValueError(f"Unknown model key: {model_key}")
        return self.engines[model_key]
