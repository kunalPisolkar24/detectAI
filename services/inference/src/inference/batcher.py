import queue
import threading
import time
from concurrent import futures
from typing import List, Tuple
from src.core.interfaces import IInferenceEngine
from src.core.exceptions import ServiceOverloadedError
import structlog
from src.metrics import BATCH_SIZE_DISTRIBUTION, BATCH_PROCESSING_TIME, BATCH_QUEUE_SIZE

logger = structlog.get_logger()

class BatchingProxy(IInferenceEngine):
    def __init__(self, engine: IInferenceEngine, batch_size: int, timeout: float, model_name: str, queue_max_size: int):
        self.engine = engine
        self.batch_size = batch_size
        self.timeout = timeout
        self.model_name = model_name
        self.queue = queue.Queue(maxsize=queue_max_size)
        self.shutdown_flag = False
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name=f"{model_name}-batch-worker")
        self.worker_thread.start()

    def predict(self, text: str) -> float:
        future = futures.Future()
        try:
            self.queue.put_nowait((text, future))
            BATCH_QUEUE_SIZE.labels(model=self.model_name).inc()
            return future.result()
        except queue.Full as exc:
            raise ServiceOverloadedError(f"{self.model_name} inference queue is full") from exc

    def predict_batch(self, texts: List[str]) -> List[float]:
        """
        Direct pass-through for explicit batch requests.
        Bypasses the dynamic batching queue.
        """
        return self.engine.predict_batch(texts)

    def _worker_loop(self):
        while not self.shutdown_flag:
            batch = []
            try:
                item = self.queue.get(timeout=0.01)
                BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                batch.append(item)
            except queue.Empty:
                continue

            start_time = time.monotonic()
            
            while len(batch) < self.batch_size:
                remaining = self.timeout - (time.monotonic() - start_time)
                if remaining <= 0:
                    break
                try:
                    item = self.queue.get(timeout=remaining)
                    BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()
                    batch.append(item)
                except queue.Empty:
                    break

            if batch:
                self._process_batch(batch)

    def _process_batch(self, batch: List[Tuple[str, futures.Future]]):
        BATCH_SIZE_DISTRIBUTION.labels(model=self.model_name).observe(len(batch))
        
        texts = [item[0] for item in batch]
        futures_list = [item[1] for item in batch]
        
        try:
            with BATCH_PROCESSING_TIME.labels(model=self.model_name).time():
                results = self.engine.predict_batch(texts)
            
            if len(results) != len(futures_list):
                raise RuntimeError("Batch results length mismatch")
                
            for i in range(len(futures_list)):
                future = futures_list[i]
                if not future.cancelled():
                    future.set_result(results[i])
                
            logger.info("batch_processed", 
                       model=self.model_name, 
                       size=len(batch))
                       
        except Exception as e:
            logger.error("batch_failed", error=str(e), model=self.model_name)
            for future in futures_list:
                if not future.cancelled():
                    future.set_exception(e)
