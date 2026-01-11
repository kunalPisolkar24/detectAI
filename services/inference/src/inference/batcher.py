import queue
import threading
import time
from concurrent import futures
from typing import List, Tuple
from src.core.interfaces import IInferenceEngine
import structlog
from src.metrics import BATCH_SIZE_DISTRIBUTION, BATCH_PROCESSING_TIME, BATCH_QUEUE_SIZE

logger = structlog.get_logger()

class BatchingProxy(IInferenceEngine):
    def __init__(self, engine, batch_size: int, timeout: float, model_name: str):
        self.engine = engine
        self.batch_size = batch_size
        self.timeout = timeout
        self.model_name = model_name
        self.queue = queue.Queue()
        self.shutdown_flag = False
        self.worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self.worker_thread.start()

    def predict(self, text: str) -> float:
        future = futures.Future()
        BATCH_QUEUE_SIZE.labels(model=self.model_name).inc()
        try:
            self.queue.put((text, future))
            return future.result()
        finally:
            BATCH_QUEUE_SIZE.labels(model=self.model_name).dec()

    def _worker_loop(self):
        while not self.shutdown_flag:
            batch = []
            try:
                item = self.queue.get(timeout=0.1)
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
            
            for future, result in zip(futures_list, results):
                future.set_result(result)
                
            logger.info("batch_processed", 
                       model=self.model_name, 
                       size=len(batch))
                       
        except Exception as e:
            logger.error("batch_failed", error=str(e), model=self.model_name)
            for future in futures_list:
                future.set_exception(e)