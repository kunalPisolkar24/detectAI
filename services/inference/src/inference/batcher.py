import asyncio
import time
from typing import List, Tuple
from src.core.interfaces import IInferenceEngine
from src.core.exceptions import ServiceOverloadedError
import structlog
from src.metrics import BATCH_SIZE_DISTRIBUTION, BATCH_PROCESSING_TIME, BATCH_QUEUE_SIZE
from circuitbreaker import circuit

logger = structlog.get_logger()

class BatchingProxy(IInferenceEngine):
    def __init__(self, engine: IInferenceEngine, batch_size: int, timeout: float, model_name: str, queue_max_size: int):
        self.engine = engine
        self.batch_size = batch_size
        self.timeout = timeout
        self.model_name = model_name
        self.queue = asyncio.Queue(maxsize=queue_max_size)
        self.shutdown_flag = False
        self.worker_task = asyncio.create_task(self._worker_loop(), name=f"{model_name}-batch-worker")

    async def predict(self, text: str) -> float:
        future = asyncio.get_running_loop().create_future()
        try:
            self.queue.put_nowait((text, future))
            BATCH_QUEUE_SIZE.labels(model=self.model_name).inc()
            return await future
        except asyncio.QueueFull as exc:
            raise ServiceOverloadedError(f"{self.model_name} inference queue is full") from exc

    def predict_batch(self, texts: List[str]) -> List[float]:
        return self.engine.predict_batch(texts)

    async def shutdown(self):
        self.shutdown_flag = True
        future = asyncio.get_running_loop().create_future()
        try:
            self.queue.put_nowait(("", future))
        except asyncio.QueueFull:
            pass
        await self.worker_task

        while not self.queue.empty():
            item = self.queue.get_nowait()
            BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
            fut = item[1]
            if not fut.done():
                fut.set_exception(ServiceOverloadedError(f"{self.model_name} service is shutting down"))

    async def _worker_loop(self):
        loop = asyncio.get_running_loop()
        while not self.shutdown_flag:
            batch = []
            try:
                item = await asyncio.wait_for(self.queue.get(), timeout=0.01)
                BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                if item[0] == "" and self.shutdown_flag:
                    break
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
                    BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                    if item[0] == "" and self.shutdown_flag:
                        break
                    batch.append(item)
                except asyncio.TimeoutError:
                    break

            if batch:
                await self._process_batch(batch, loop)

    async def _process_batch(self, batch: List[Tuple[str, asyncio.Future]], loop: asyncio.AbstractEventLoop):
        BATCH_SIZE_DISTRIBUTION.labels(model=self.model_name).observe(len(batch))
        
        texts = [item[0] for item in batch]
        futures_list = [item[1] for item in batch]
        
        @circuit(failure_threshold=3, expected_exception=Exception)
        def _guarded_predict_batch():
            return self.engine.predict_batch(texts)

        try:
            with BATCH_PROCESSING_TIME.labels(model=self.model_name).time():
                results = await loop.run_in_executor(None, _guarded_predict_batch)
            
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
