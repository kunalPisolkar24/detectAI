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
        if len(chunks) > 5000:
            logger.warning("large_chunk_count", count=len(chunks))
        if not chunks:
            return

        pending: asyncio.Queue[int] = asyncio.Queue()
        for index in range(len(chunks)):
            pending.put_nowait(index)
        results: asyncio.Queue[tuple[int, bool, object]] = asyncio.Queue()
        workers = [
            asyncio.create_task(
                self._pool_worker(engine, chunks, pending, results, request_is_active, operation, model_key, telemetry)
            )
            for _ in range(min(self.max_inflight, len(chunks)))
        ]

        settled = 0
        try:
            while settled < len(chunks):
                idx, ok, payload = await results.get()
                settled += 1
                if not ok:
                    assert isinstance(payload, BaseException)
                    raise payload
                assert isinstance(payload, float)
                yield idx, payload
        except BaseException:
            for w in workers:
                if not w.done():
                    w.cancel()
            if workers:
                try:
                    await asyncio.shield(asyncio.gather(*workers, return_exceptions=True))
                except asyncio.CancelledError:
                    pass
            raise

    async def _pool_worker(
        self,
        engine: IAsyncInferenceEngine,
        chunks: list[DocumentChunk],
        pending: asyncio.Queue[int],
        results: asyncio.Queue[tuple[int, bool, object]],
        request_is_active: Callable[[], bool] | None,
        operation: str,
        model_key: str,
        telemetry: ITelemetryReporter | None,
    ) -> None:
        while True:
            try:
                idx = pending.get_nowait()
            except asyncio.QueueEmpty:
                return
            if not self._is_active(request_is_active):
                results.put_nowait((idx, False, asyncio.CancelledError("Client disconnected")))
                return
            try:
                value = await self._predict_chunk(engine, chunks[idx].text, operation, model_key, telemetry)
            except asyncio.CancelledError:
                raise
            except BaseException as err:  # noqa: BLE001 - any chunk failure must be reported per item
                results.put_nowait((idx, False, err))
                return
            else:
                results.put_nowait((idx, True, value))

    @staticmethod
    def _is_active(request_is_active: Callable[[], bool] | None) -> bool:
        if request_is_active is None:
            return True
        try:
            return bool(request_is_active())
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - caller hook may raise anything; treat as disconnect
            logger.warning("request_is_active_check_failed", error=str(e))
            return False

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
