from __future__ import annotations

import asyncio
import inspect
from typing import AsyncGenerator, Callable, Optional

import structlog

from src.application.ports.inbound.document_analysis import DocumentAnalysisUseCase
from src.application.ports.outbound.health import IEngineHealthReporter
from src.application.ports.outbound.inference import IAsyncInferenceEngine
from src.application.ports.outbound.telemetry import ITelemetryReporter
from src.application.services.aggregation import ResultAggregator
from src.application.services.chunking import ChunkPlanner
from src.application.services.dispatcher import ConcurrencyDispatcher
from src.application.services.text_pipeline import TextPreparationPipeline
from src.application.services.validation import InputValidator
from src.domain.exceptions import InvalidInputError, ServiceOverloadedError
from src.domain.models import BatcherHealthStatus, DocumentProgress, DocumentScore, DocumentStarted

logger = structlog.get_logger()


class DocumentAnalysisService(DocumentAnalysisUseCase):
    def __init__(
        self,
        engines: dict[str, IAsyncInferenceEngine],
        planners: dict[str, ChunkPlanner],
        validator: InputValidator,
        aggregator: ResultAggregator,
        max_inflight_chunks: int,
        telemetry: ITelemetryReporter,
        health_reporters: dict[str, IEngineHealthReporter] | None = None,
    ) -> None:
        if not engines:
            raise ValueError("engines must be non-empty")
        if not planners:
            raise ValueError("planners must be non-empty")
        if validator is None or aggregator is None or telemetry is None:
            raise ValueError("validator, aggregator, telemetry are required")
        if set(engines.keys()) != set(planners.keys()):
            raise ValueError(
                f"engines keys {set(engines.keys())} must match planners keys {set(planners.keys())}"
            )
        for k, e in engines.items():
            if not inspect.iscoroutinefunction(getattr(e, "predict", None)):
                raise TypeError(f"Engine '{k}' must expose an async predict method")
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
            validated, chunks = self._prepare(text, model_key, operation)
            engine = self._get_engine(model_key)
            probs = await self._collect_probs(engine, chunks, request_is_active, operation, model_key)
            result = self.aggregator.aggregate(chunks, probs, len(validated))
            self._record_request(operation, model_key, "success")
            return result
        except InvalidInputError:
            self._record_request(operation, model_key, "invalid_argument")
            raise
        except ServiceOverloadedError:
            self._record_request(operation, model_key, "overloaded")
            raise
        except asyncio.CancelledError:
            self._record_request(operation, model_key, "cancelled")
            raise
        except Exception:
            self._record_request(operation, model_key, "internal")
            raise

    async def stream(
        self,
        text: str,
        model_key: str,
        request_is_active: Optional[Callable[[], bool]] = None,
    ) -> AsyncGenerator[DocumentStarted | DocumentProgress | DocumentScore, None]:
        operation = "stream"
        try:
            validated, chunks = self._prepare(text, model_key, operation)
            engine = self._get_engine(model_key)
            probs: list[float] = [0.0] * len(chunks)
            processed = 0
            yield DocumentStarted(total_chars=len(validated), total_chunks=len(chunks))
            async for idx, prob in self.dispatcher.execute_progressively(
                engine, chunks, request_is_active, operation=operation, model_key=model_key, telemetry=self.telemetry
            ):
                probs[idx] = prob
                self._safe_telemetry(lambda: self.telemetry.record_document_chunk_processed(operation, model_key))
                processed += 1
                yield DocumentProgress(processed_chunks=processed, total_chunks=len(chunks))
            final = self.aggregator.aggregate(chunks, probs, len(validated))
            yield final
            self._record_request(operation, model_key, "success")
        except InvalidInputError:
            self._record_request(operation, model_key, "invalid_argument")
            raise
        except ServiceOverloadedError:
            self._record_request(operation, model_key, "overloaded")
            raise
        except asyncio.CancelledError:
            self._record_request(operation, model_key, "cancelled")
            raise
        except Exception:
            self._record_request(operation, model_key, "internal")
            raise

    async def shutdown(self) -> None:
        for name, engine in self.engines.items():
            if not hasattr(engine, "shutdown"):
                continue
            try:
                fn = engine.shutdown
                if inspect.iscoroutinefunction(fn):
                    await fn()
                else:
                    res = fn()
                    if inspect.isawaitable(res):
                        await res
            except Exception as e:
                logger.error("engine_shutdown_failed", engine=name, error=str(e), exc_info=True)

    def _prepare(self, text: str, model_key: str, operation: str):
        validated, chunks = self.prep_pipeline.prepare(text, model_key)
        self._safe_telemetry(
            lambda: self.telemetry.observe_document_plan(operation, model_key, len(validated), len(chunks))
        )
        return validated, chunks

    async def _collect_probs(self, engine, chunks, request_is_active, operation, model_key):
        probs = [0.0] * len(chunks)
        async for idx, prob in self.dispatcher.execute_progressively(
            engine, chunks, request_is_active, operation=operation, model_key=model_key, telemetry=self.telemetry
        ):
            probs[idx] = prob
            self._safe_telemetry(lambda: self.telemetry.record_document_chunk_processed(operation, model_key))
        return probs

    def _get_engine(self, model_key: str) -> IAsyncInferenceEngine:
        if model_key not in self.engines:
            raise InvalidInputError(f"Unknown model key: {model_key}")
        reporter = self.health_reporters.get(model_key)
        if reporter is not None:
            try:
                snap = reporter.health_snapshot()
                if snap.status != BatcherHealthStatus.SERVING:
                    logger.warning("engine_not_serving", model=model_key, status=snap.status.value)
                    if snap.status in (
                        BatcherHealthStatus.QUEUE_FULL,
                        BatcherHealthStatus.WORKER_UNAVAILABLE,
                        BatcherHealthStatus.CIRCUIT_OPEN,
                    ):
                        self._safe_telemetry(lambda: self.telemetry.record_queue_rejected(model_key, "health_shed"))
                        raise ServiceOverloadedError(f"{model_key} is {snap.status.value}")
            except ServiceOverloadedError:
                raise
            except Exception as e:
                logger.warning("health_check_failed", model=model_key, error=str(e))
        return self.engines[model_key]

    def _record_request(self, operation: str, model_key: str, status: str) -> None:
        self._safe_telemetry(lambda: self.telemetry.record_document_request(operation, model_key, status))

    @staticmethod
    def _safe_telemetry(fn) -> None:
        try:
            fn()
        except Exception as e:
            logger.warning("telemetry_failed", error=str(e))


__all__ = ["DocumentAnalysisService", "ConcurrencyDispatcher", "TextPreparationPipeline"]
