from __future__ import annotations

import asyncio
import math
from typing import AsyncGenerator, Callable, List, Optional, Tuple

import structlog

from src.application.ports.outbound.inference import IAsyncInferenceEngine
from src.application.ports.outbound.telemetry import ITelemetryReporter
from src.domain.exceptions import InvalidInputError
from src.domain.models import DocumentChunk

logger = structlog.get_logger()

_CHUNK_TIMEOUT = 30.0


class ConcurrencyDispatcher:
    def __init__(self, max_inflight: int) -> None:
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

        if len(chunks) > 5000:
            logger.warning("large_chunk_count", count=len(chunks))

        tasks = [asyncio.create_task(_worker(i, c)) for i, c in enumerate(chunks)]

        try:
            for fut in asyncio.as_completed(tasks):
                yield await fut
        except BaseException:
            for t in tasks:
                if not t.done():
                    t.cancel()
            if tasks:
                try:
                    await asyncio.shield(asyncio.gather(*tasks, return_exceptions=True))
                except asyncio.CancelledError:
                    pass
            raise

    async def _predict_chunk(
        self,
        engine: IAsyncInferenceEngine,
        text: str,
        operation: str,
        model_key: str,
        telemetry: Optional[ITelemetryReporter],
    ) -> float:
        if telemetry is not None:
            try:
                telemetry.track_document_chunk_started(operation, model_key)
            except Exception as e:
                logger.warning("telemetry_started_failed", error=str(e))
        try:
            raw = await asyncio.wait_for(engine.predict(text), timeout=_CHUNK_TIMEOUT)
            try:
                val = float(raw)
            except Exception as e:
                raise InvalidInputError(f"Engine returned non-numeric {raw!r}: {e}") from e
            if not math.isfinite(val) or not 0.0 <= val <= 1.0:
                raise InvalidInputError(f"Engine returned out-of-range probability {val}")
            return val
        except BaseException as e:
            if telemetry is not None:
                try:
                    if isinstance(e, asyncio.TimeoutError):
                        telemetry.record_document_chunk_failed(operation, model_key, "timeout")
                    elif isinstance(e, asyncio.CancelledError):
                        telemetry.record_document_chunk_failed(operation, model_key, "cancelled")
                    elif isinstance(e, InvalidInputError):
                        telemetry.record_document_chunk_failed(operation, model_key, "invalid")
                    else:
                        telemetry.record_document_chunk_failed(operation, model_key, "error")
                except Exception:
                    pass
            raise
        finally:
            if telemetry is not None:
                try:
                    telemetry.track_document_chunk_finished(operation, model_key)
                except Exception as e:
                    logger.warning("telemetry_finished_failed", error=str(e))
