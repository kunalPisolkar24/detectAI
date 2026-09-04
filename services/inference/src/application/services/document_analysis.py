from __future__ import annotations

import asyncio
import inspect
import math
from typing import AsyncGenerator, Callable, List, Optional, Tuple

from src.application.ports.outbound.inference import IAsyncInferenceEngine, IEngineHealthReporter
from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import ChunkPlanner
from src.domain.exceptions import InvalidInputError, ServiceOverloadedError
from src.domain.models import DocumentChunk, DocumentProgress, DocumentScore, DocumentStarted
from src.application.services.validation import InputValidator
from src.application.ports.outbound.telemetry import ITelemetryReporter
import structlog

logger = structlog.get_logger()
_CHUNK_TIMEOUT = 30.0

from src.infrastructure.metrics import (
    record_document_chunk_failed,
    record_document_request,
    record_queue_rejected,
)


class TextPreparationPipeline:
    def __init__(self, validator: InputValidator, planners: dict[str, ChunkPlanner]):
        if validator is None:
            raise ValueError("validator is required")
        if not planners:
            raise ValueError("planners must be non-empty")
        self.validator = validator
        self.planners = planners

    def prepare(self, text: str, model_key: str) -> Tuple[str, List[DocumentChunk]]:
        if model_key not in self.planners:
            raise InvalidInputError(f"Unknown model key: {model_key}")
        validated_text = self.validator.validate(text)
        chunks = self.planners[model_key].plan(validated_text)
        if not chunks:
            raise InvalidInputError("No chunks were generated for the provided text")
        return validated_text, chunks


class ConcurrencyDispatcher:
    def __init__(self, max_inflight: int):
        if not isinstance(max_inflight, int) or max_inflight < 1:
            raise ValueError("max_inflight must be an int >=1")
        self.max_inflight = max_inflight

    async def execute_progressively(
        self,
        engine: IAsyncInferenceEngine,
        chunks: List[DocumentChunk],
        request_is_active: Optional[Callable[[], bool]] = None,
        operation: str = "analyze",
        model_key: str = "unknown",
        telemetry: Optional[ITelemetryReporter] = None,
    ) -> AsyncGenerator[Tuple[int, float], None]:
        semaphore = asyncio.Semaphore(self.max_inflight)

        async def _worker(chunk_index: int, chunk: DocumentChunk) -> Tuple[int, float]:
            async with semaphore:
                # Guard request_is_active callback
                try:
                    if request_is_active is not None and not request_is_active():
                        raise asyncio.CancelledError("Client disconnected")
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    logger.warning("request_is_active_check_failed", error=str(e))
                    raise asyncio.CancelledError("Client disconnected") from e
                result = await self._predict_chunk(engine, chunk.text, operation, model_key, telemetry)
                return chunk_index, result

        # Bounded fan-out: chunks already capped by planner max_chunks, but avoid creating 10k tasks at once for memory
        # For simplicity, create all tasks but semaphore limits concurrency; if chunks > 5000, warn
        if len(chunks) > 5000:
            logger.warning("large_chunk_count", count=len(chunks))
        tasks = [asyncio.create_task(_worker(i, chunk)) for i, chunk in enumerate(chunks)]

        try:
            for future in asyncio.as_completed(tasks):
                yield await future
        except BaseException:
            for task in tasks:
                if not task.done():
                    task.cancel()
            if tasks:
                # Shield gather from outer cancellation to ensure cleanup
                try:
                    await asyncio.shield(asyncio.gather(*tasks, return_exceptions=True))
                except asyncio.CancelledError:
                    pass
            raise

    async def _predict_chunk(
        self, engine: IAsyncInferenceEngine, text: str, operation: str, model_key: str, telemetry: Optional[ITelemetryReporter]
    ) -> float:
        if telemetry is not None:
            try:
                telemetry.track_document_chunk_started(operation, model_key)
            except Exception as e:
                logger.warning("telemetry_started_failed", error=str(e))
        try:
            # Per-chunk timeout to avoid head-of-line blocking
            raw = await asyncio.wait_for(engine.predict(text), timeout=_CHUNK_TIMEOUT)
            try:
                val = float(raw)
            except Exception as e:
                raise InvalidInputError(f"Engine returned non-numeric {raw!r}: {e}") from e
            if not math.isfinite(val) or not 0.0 <= val <= 1.0:
                raise InvalidInputError(f"Engine returned out-of-range probability {val}")
            return val
        except BaseException as e:
            try:
                if isinstance(e, asyncio.TimeoutError):
                    record_document_chunk_failed(operation, model_key, "timeout")
                elif isinstance(e, asyncio.CancelledError):
                    record_document_chunk_failed(operation, model_key, "cancelled")
                elif isinstance(e, InvalidInputError):
                    record_document_chunk_failed(operation, model_key, "invalid")
                else:
                    record_document_chunk_failed(operation, model_key, "error")
            except Exception:
                pass
            raise
        finally:
            if telemetry is not None:
                try:
                    telemetry.track_document_chunk_finished(operation, model_key)
                except Exception as e:
                    logger.warning("telemetry_finished_failed", error=str(e))


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
        if not engines:
            raise ValueError("engines must be non-empty")
        if not planners:
            raise ValueError("planners must be non-empty")
        if validator is None or aggregator is None or telemetry is None:
            raise ValueError("validator, aggregator, telemetry are required")
        if set(engines.keys()) != set(planners.keys()):
            raise ValueError(f"engines keys {set(engines.keys())} must match planners keys {set(planners.keys())}")
        for model_key, engine in engines.items():
            if not inspect.iscoroutinefunction(getattr(engine, "predict", None)):
                raise TypeError(f"Engine '{model_key}' must expose an async predict method")
        if not isinstance(max_inflight_chunks, int) or max_inflight_chunks < 1:
            raise ValueError("max_inflight_chunks must be an int >=1")
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
        try:
            validated_text, chunks = self.prep_pipeline.prepare(text, model_key)
            engine = self._get_engine(model_key)
            try:
                self.telemetry.observe_document_plan(operation, model_key, len(validated_text), len(chunks))
            except Exception as e:
                logger.warning("telemetry_plan_failed", error=str(e))
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
                try:
                    self.telemetry.record_document_chunk_processed(operation, model_key)
                except Exception as e:
                    logger.warning("telemetry_processed_failed", error=str(e))

            result = self.aggregator.aggregate(chunks, probabilities, len(validated_text))
            try:
                record_document_request(operation, model_key, "success")
            except Exception:
                pass
            return result
        except InvalidInputError:
            try:
                record_document_request(operation, model_key, "invalid_argument")
            except Exception:
                pass
            raise
        except ServiceOverloadedError:
            try:
                record_document_request(operation, model_key, "overloaded")
            except Exception:
                pass
            raise
        except asyncio.CancelledError:
            try:
                record_document_request(operation, model_key, "cancelled")
            except Exception:
                pass
            raise
        except Exception:
            try:
                record_document_request(operation, model_key, "internal")
            except Exception:
                pass
            raise

    async def stream(
        self,
        text: str,
        model_key: str,
        request_is_active: Optional[Callable[[], bool]] = None,
    ) -> AsyncGenerator[DocumentStarted | DocumentProgress | DocumentScore, None]:
        operation = "stream"
        try:
            validated_text, chunks = self.prep_pipeline.prepare(text, model_key)
            engine = self._get_engine(model_key)
            try:
                self.telemetry.observe_document_plan(operation, model_key, len(validated_text), len(chunks))
            except Exception as e:
                logger.warning("telemetry_plan_failed", error=str(e))
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
                try:
                    self.telemetry.record_document_chunk_processed(operation, model_key)
                except Exception as e:
                    logger.warning("telemetry_processed_failed", error=str(e))
                processed_chunks += 1
                yield DocumentProgress(processed_chunks=processed_chunks, total_chunks=len(chunks))

            final = self.aggregator.aggregate(chunks, probabilities, len(validated_text))
            yield final
            try:
                record_document_request(operation, model_key, "success")
            except Exception:
                pass
        except InvalidInputError:
            try:
                record_document_request(operation, model_key, "invalid_argument")
            except Exception:
                pass
            raise
        except ServiceOverloadedError:
            try:
                record_document_request(operation, model_key, "overloaded")
            except Exception:
                pass
            raise
        except asyncio.CancelledError:
            try:
                record_document_request(operation, model_key, "cancelled")
            except Exception:
                pass
            raise
        except Exception:
            try:
                record_document_request(operation, model_key, "internal")
            except Exception:
                pass
            raise

    async def shutdown(self) -> None:
        for name, engine in self.engines.items():
            if hasattr(engine, "shutdown"):
                try:
                    shutdown = engine.shutdown
                    if inspect.iscoroutinefunction(shutdown):
                        await shutdown()
                    else:
                        # Try calling and await if it returns coroutine
                        result = shutdown()
                        if inspect.isawaitable(result):
                            await result
                except Exception as e:
                    logger.error("engine_shutdown_failed", engine=name, error=str(e), exc_info=True)

    def _get_engine(self, model_key: str) -> IAsyncInferenceEngine:
        if model_key not in self.engines:
            raise InvalidInputError(f"Unknown model key: {model_key}")
        # Consult health if available
        reporter = self.health_reporters.get(model_key)
        if reporter is not None:
            try:
                snap = reporter.health_snapshot()
                from src.domain.models import BatcherHealthStatus

                if snap.status != BatcherHealthStatus.SERVING:
                    logger.warning("engine_not_serving", model=model_key, status=snap.status.value)
                    if snap.status in (BatcherHealthStatus.QUEUE_FULL, BatcherHealthStatus.WORKER_UNAVAILABLE, BatcherHealthStatus.CIRCUIT_OPEN):
                        try:
                            record_queue_rejected(model_key, "health_shed")
                        except Exception:
                            pass
                        raise ServiceOverloadedError(f"{model_key} is {snap.status.value}")
            except ServiceOverloadedError:
                raise
            except Exception as e:
                logger.warning("health_check_failed", model=model_key, error=str(e))
        return self.engines[model_key]
