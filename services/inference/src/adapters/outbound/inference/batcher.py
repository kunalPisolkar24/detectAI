import asyncio
import time
from dataclasses import dataclass
from typing import List
from circuitbreaker import CircuitBreaker, CircuitBreakerError

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
    ):
        self.engine = engine
        self.batch_size = batch_size
        self.timeout = timeout
        self.model_name = model_name
        self.queue = asyncio.Queue(maxsize=queue_max_size)
        self.shutdown_flag = False
        self.worker_task: asyncio.Task | None = None
        self._circuit_breaker = CircuitBreaker(
            failure_threshold=15,
            recovery_timeout=10,
            expected_exception=Exception,
            name=f"{model_name}-batch",
        )
        self._guarded_predict_batch = self._circuit_breaker.decorate(self.engine.predict_batch)

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
        elif self.worker_task is None or self.worker_task.done():
            status = BatcherHealthStatus.WORKER_UNAVAILABLE
        elif self._circuit_breaker.opened:
            status = BatcherHealthStatus.CIRCUIT_OPEN
        elif self.queue.full():
            status = BatcherHealthStatus.QUEUE_FULL
        else:
            status = BatcherHealthStatus.SERVING

        return BatcherHealthSnapshot(
            status=status,
            queue_size=self.queue.qsize(),
            queue_capacity=self.queue.maxsize,
            circuit_open_remaining=self._circuit_breaker.open_remaining if self._circuit_breaker.opened else None,
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
        loop = asyncio.get_running_loop()
        while not self.shutdown_flag:
            batch: list[PendingPrediction] = []
            try:
                item = await asyncio.wait_for(self.queue.get(), timeout=0.01)
                if item is _SHUTDOWN_SENTINEL:
                    break
                BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                batch.append(item)
            except asyncio.TimeoutError:
                continue

            start_time = time.monotonic()
            
            while len(batch) < self.batch_size:
                remaining = self.timeout - (time.monotonic() - start_time)
                if remaining <= 0:
                    break
                try:
                    item = await asyncio.wait_for(self.queue.get(), timeout=remaining)
                    if item is _SHUTDOWN_SENTINEL:
                        break
                    BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                    batch.append(item)
                except asyncio.TimeoutError:
                    break

            if batch:
                await self._process_batch(batch, loop)

    async def _process_batch(self, batch: List[PendingPrediction], loop: asyncio.AbstractEventLoop):
        BATCH_SIZE_DISTRIBUTION.labels(model=self.model_name).observe(len(batch))
        
        texts = [item.text for item in batch]
        futures_list = [item.future for item in batch]

        try:
            with BATCH_PROCESSING_TIME.labels(model=self.model_name).time():
                results = await loop.run_in_executor(None, self._guarded_predict_batch, texts)
            
            if len(results) != len(futures_list):
                raise RuntimeError("Batch results length mismatch")
                
            for i in range(len(futures_list)):
                future = futures_list[i]
                if not future.done():
                    future.set_result(results[i])
                
        except CircuitBreakerError as exc:
            error = ServiceOverloadedError(f"{self.model_name} inference circuit is open")
            for future in futures_list:
                if not future.done():
                    future.set_exception(error)
            logger.warning("batch_circuit_open", model=self.model_name, error=str(exc))
        except Exception as e:
            for future in futures_list:
                if not future.done():
                    future.set_exception(e)
