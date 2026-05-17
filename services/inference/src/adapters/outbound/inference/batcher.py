import asyncio
import time
import concurrent.futures
from dataclasses import dataclass
from typing import List, Set
from src.domain.exceptions import ServiceOverloadedError
from src.domain.models import (
    BatcherHealthSnapshot,
    BatcherHealthStatus,
)
from src.application.ports.outbound.inference import (
    IAsyncInferenceEngine,
    IEngineHealthReporter,
    ISyncBatchInferenceEngine,
)
from src.infrastructure.metrics import BATCH_SIZE_DISTRIBUTION, BATCH_PROCESSING_TIME, BATCH_QUEUE_SIZE
import structlog

logger = structlog.get_logger()
_SHUTDOWN_SENTINEL = object()


@dataclass(slots=True)
class PendingPrediction:
    text: str
    future: asyncio.Future


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
    ):
        self.engine = engine
        self.batch_size = batch_size
        self.timeout = timeout
        self.model_name = model_name
        self.queue = asyncio.Queue(maxsize=queue_max_size)
        self.shutdown_flag = False
        self.worker_task: asyncio.Task | None = None
        self._guarded_predict_batch = self.engine.predict_batch
        self.executor = executor
        self.semaphore = asyncio.Semaphore(max_concurrent_batches)
        self.active_batches: Set[asyncio.Task] = set()

    async def start(self) -> None:
        if self.shutdown_flag:
            raise RuntimeError(f"{self.model_name} batcher cannot be started after shutdown")
        if self.worker_task is None or self.worker_task.done():
            self.worker_task = asyncio.create_task(
                self._worker_loop(),
                name=f"{self.model_name}-batch-worker",
            )

    async def predict(self, text: str) -> float:
        if self.shutdown_flag:
            raise ServiceOverloadedError(f"{self.model_name} service is shutting down")

        if self.worker_task is None:
            raise RuntimeError(f"{self.model_name} batcher has not been started")

        if self.worker_task.done():
            raise ServiceOverloadedError(f"{self.model_name} batch worker is unavailable")

        future = asyncio.get_running_loop().create_future()
        try:
            self.queue.put_nowait(PendingPrediction(text=text, future=future))
            BATCH_QUEUE_SIZE.labels(model=self.model_name).inc()
            try:
                return await future
            except asyncio.CancelledError:
                if not future.done():
                    future.cancel()
                raise
        except asyncio.QueueFull as exc:
            raise ServiceOverloadedError(f"{self.model_name} inference queue is full") from exc

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

    async def shutdown(self):
        self.shutdown_flag = True

        worker_task = self.worker_task
        worker_error = None
        if worker_task is not None:
            try:
                self.queue.put_nowait(_SHUTDOWN_SENTINEL)
            except asyncio.QueueFull:
                pass
            try:
                await worker_task
            except Exception as exc:
                worker_error = exc

        if self.active_batches:
            await asyncio.gather(*self.active_batches, return_exceptions=True)

        while not self.queue.empty():
            item = self.queue.get_nowait()
            if item is _SHUTDOWN_SENTINEL:
                continue
            BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
            if not item.future.done():
                item.future.set_exception(ServiceOverloadedError(f"{self.model_name} service is shutting down"))

        if worker_error is not None:
            raise worker_error

    async def _worker_loop(self):
        while not self.shutdown_flag:
            try:
                item = await self.queue.get()
                if item is _SHUTDOWN_SENTINEL:
                    break
                BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                batch: List[PendingPrediction] = [item]
                
                start_time = time.monotonic()
                while len(batch) < self.batch_size:
                    remaining = self.timeout - (time.monotonic() - start_time)
                    if remaining <= 0:
                        break
                    try:
                        item = await asyncio.wait_for(self.queue.get(), timeout=remaining)
                        if item is _SHUTDOWN_SENTINEL:
                            try:
                                self.queue.put_nowait(_SHUTDOWN_SENTINEL)
                            except asyncio.QueueFull:
                                pass
                            break
                        BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                        batch.append(item)
                    except asyncio.TimeoutError:
                        break

                if batch:
                    task = asyncio.create_task(self._process_batch_with_semaphore(batch))
                    self.active_batches.add(task)
                    task.add_done_callback(self.active_batches.discard)

            except Exception as e:
                logger.error("batch_worker_loop_error", model=self.model_name, error=str(e))
                await asyncio.sleep(0.1)

    async def _process_batch_with_semaphore(self, batch: List[PendingPrediction]):
        async with self.semaphore:
            await self._process_batch(batch)

    async def _process_batch(self, batch: List[PendingPrediction]):
        loop = asyncio.get_running_loop()
        BATCH_SIZE_DISTRIBUTION.labels(model=self.model_name).observe(len(batch))
        
        texts = [item.text for item in batch]
        futures_list = [item.future for item in batch]

        try:
            with BATCH_PROCESSING_TIME.labels(model=self.model_name).time():
                results = await loop.run_in_executor(self.executor, self._guarded_predict_batch, texts)
            
            if len(results) != len(futures_list):
                raise RuntimeError("Batch results length mismatch")
                
            for i in range(len(futures_list)):
                future = futures_list[i]
                if not future.done():
                    future.set_result(results[i])
                
        except Exception as e:
            for future in futures_list:
                if not future.done():
                    future.set_exception(e)
