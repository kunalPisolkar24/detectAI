import asyncio
import concurrent.futures
import time
from dataclasses import dataclass
from typing import List, Set

import structlog

from src.application.ports.outbound.health import IEngineHealthReporter
from src.application.ports.outbound.inference import IAsyncInferenceEngine, ISyncBatchInferenceEngine
from src.domain.exceptions import ServiceOverloadedError
from src.domain.models import BatcherHealthSnapshot, BatcherHealthStatus
from src.infrastructure.metrics import BATCH_QUEUE_SIZE, observe_queue_wait, record_queue_rejected

logger = structlog.get_logger()
_SHUTDOWN_SENTINEL = object()
_PROCESSING_TIMEOUT = 30.0


@dataclass(slots=True)
class PendingPrediction:
    text: str
    future: asyncio.Future
    enqueue_time: float = 0.0


class BatchingProxy(IAsyncInferenceEngine, IEngineHealthReporter):
    def __init__(
        self,
        engine: ISyncBatchInferenceEngine,
        batch_size: int,
        timeout: float,
        model_name: str,
        queue_max_size: int,
        executor: concurrent.futures.Executor,
        max_concurrent_batches: int = 4,
        telemetry=None,
    ) -> None:
        if batch_size <= 0:
            raise ValueError("batch_size must be >0")
        if timeout <= 0:
            raise ValueError("timeout must be >0")
        if queue_max_size <= 0:
            raise ValueError("queue_max_size must be >0")
        if max_concurrent_batches <= 0:
            raise ValueError("max_concurrent_batches must be >0")
        self.engine = engine
        self.batch_size = batch_size
        self.timeout = timeout
        self.model_name = model_name
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=queue_max_size)
        self.shutdown_flag = False
        self.worker_task: asyncio.Task | None = None
        self._guarded_predict_batch = self.engine.predict_batch
        self.executor = executor
        self.semaphore = asyncio.Semaphore(max_concurrent_batches)
        self.active_batches: Set[asyncio.Task] = set()
        self._start_lock = asyncio.Lock()
        self._state_lock = asyncio.Lock()
        self.telemetry = telemetry

    def _record_queue_rejected(self, reason: str) -> None:
        if self.telemetry is not None:
            try:
                self.telemetry.record_queue_rejected(self.model_name, reason)
                return
            except Exception:
                pass
        try:
            record_queue_rejected(self.model_name, reason)
        except Exception:
            pass

    def _observe_queue_wait(self, seconds: float) -> None:
        if self.telemetry is not None:
            try:
                self.telemetry.observe_queue_wait(self.model_name, seconds)
                return
            except Exception:
                pass
        try:
            observe_queue_wait(self.model_name, seconds)
        except Exception:
            pass

    async def start(self) -> None:
        async with self._start_lock:
            if self.shutdown_flag:
                raise RuntimeError(f"{self.model_name} batcher cannot be started after shutdown")
            if self.worker_task is None or self.worker_task.done():
                if self.worker_task is not None and self.worker_task.done():
                    exc = self.worker_task.exception()
                    if exc is not None:
                        logger.error("batch_worker_previous_crash", model=self.model_name, error=str(exc))
                self.worker_task = asyncio.create_task(
                    self._worker_loop(),
                    name=f"{self.model_name}-batch-worker",
                )

    async def predict(self, text: str) -> float:
        async with self._state_lock:
            if self.shutdown_flag:
                self._record_queue_rejected("shutting_down")
                raise ServiceOverloadedError(f"{self.model_name} service is shutting down")
            if self.worker_task is None:
                raise RuntimeError(f"{self.model_name} batcher has not been started")
            if self.worker_task.done():
                self._record_queue_rejected("worker_unavailable")
                raise ServiceOverloadedError(f"{self.model_name} batch worker is unavailable")

            loop = asyncio.get_running_loop()
            future: asyncio.Future = loop.create_future()
            try:
                self.queue.put_nowait(PendingPrediction(text=text, future=future, enqueue_time=time.monotonic()))
                BATCH_QUEUE_SIZE.labels(model=self.model_name).inc()
            except asyncio.QueueFull as exc:
                future.cancel()
                self._record_queue_rejected("queue_full")
                raise ServiceOverloadedError(f"{self.model_name} inference queue is full") from exc

        try:
            return await future
        except asyncio.CancelledError:
            if not future.done():
                future.cancel()
            raise

    def health_snapshot(self) -> BatcherHealthSnapshot:
        if self.shutdown_flag:
            status = BatcherHealthStatus.SHUTTING_DOWN
        elif self.worker_task is None:
            status = BatcherHealthStatus.INITIALIZING
        elif self.worker_task.done():
            status = BatcherHealthStatus.WORKER_UNAVAILABLE
        elif self.queue.full():
            status = BatcherHealthStatus.QUEUE_FULL
        else:
            status = BatcherHealthStatus.SERVING

        return BatcherHealthSnapshot(
            status=status,
            queue_size=self.queue.qsize(),
            queue_capacity=self.queue.maxsize,
            circuit_open_remaining=None,
        )

    async def shutdown(self) -> None:
        async with self._state_lock:
            self.shutdown_flag = True

        worker_task = self.worker_task
        worker_error = None

        # Try to deliver sentinel gracefully, retry if queue full
        if worker_task is not None and not worker_task.done():
            sentinel_delivered = False
            for _ in range(5):
                try:
                    self.queue.put_nowait(_SHUTDOWN_SENTINEL)
                    sentinel_delivered = True
                    break
                except asyncio.QueueFull:
                    await asyncio.sleep(0.05)
            if not sentinel_delivered:
                # Queue stayed full — cancel worker to unblock
                worker_task.cancel()

            try:
                await asyncio.wait_for(worker_task, timeout=5)
            except asyncio.TimeoutError:
                logger.warning("batch_worker_shutdown_timeout", model=self.model_name)
                worker_task.cancel()
                try:
                    await worker_task
                except BaseException:
                    pass
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                worker_error = exc
        elif worker_task is not None and worker_task.done():
            try:
                await worker_task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                worker_error = exc

        if self.active_batches:
            try:
                await asyncio.wait_for(
                    asyncio.gather(*self.active_batches, return_exceptions=True),
                    timeout=_PROCESSING_TIMEOUT + 5,
                )
            except asyncio.TimeoutError:
                logger.warning("batch_shutdown_timeout", model=self.model_name, active=len(self.active_batches))
                for t in list(self.active_batches):
                    t.cancel()

        drained = 0
        while True:
            try:
                item = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if item is _SHUTDOWN_SENTINEL:
                continue
            drained += 1
            try:
                BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
            except Exception:
                pass
            self._record_queue_rejected("shutting_down")
            if not item.future.done():
                item.future.set_exception(ServiceOverloadedError(f"{self.model_name} service is shutting down"))
        if drained:
            logger.info("batch_shutdown_drained", model=self.model_name, drained=drained)

        if worker_error is not None:
            raise worker_error

    async def _worker_loop(self) -> None:
        while not self.shutdown_flag:
            try:
                try:
                    item = await self.queue.get()
                except asyncio.CancelledError:
                    break
                if item is _SHUTDOWN_SENTINEL:
                    break
                try:
                    BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                except Exception:
                    pass
                if getattr(item, "enqueue_time", 0):
                    self._observe_queue_wait(time.monotonic() - item.enqueue_time)

                batch: List[PendingPrediction] = [item]
                start = time.monotonic()
                while len(batch) < self.batch_size:
                    remaining = self.timeout - (time.monotonic() - start)
                    if remaining <= 0:
                        break
                    try:
                        nxt = await asyncio.wait_for(self.queue.get(), timeout=remaining)
                        if nxt is _SHUTDOWN_SENTINEL:
                            try:
                                self.queue.put_nowait(_SHUTDOWN_SENTINEL)
                            except asyncio.QueueFull:
                                pass
                            break
                        try:
                            BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                        except Exception:
                            pass
                        if getattr(nxt, "enqueue_time", 0):
                            self._observe_queue_wait(time.monotonic() - nxt.enqueue_time)
                        batch.append(nxt)
                    except asyncio.TimeoutError:
                        break
                    except asyncio.CancelledError:
                        break

                if batch:
                    task = asyncio.create_task(self._process_batch_with_semaphore(batch))
                    self.active_batches.add(task)
                    task.add_done_callback(self.active_batches.discard)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("batch_worker_loop_error", model=self.model_name, error=str(e), exc_info=True)
                await asyncio.sleep(0.1)

    async def _process_batch_with_semaphore(self, batch: List[PendingPrediction]) -> None:
        async with self.semaphore:
            await self._process_batch(batch)

    async def _process_batch(self, batch: List[PendingPrediction]) -> None:
        from src.adapters.outbound.inference.batching.processor import process_batch

        await process_batch(batch, self._guarded_predict_batch, self.executor, self.model_name, self.telemetry)
