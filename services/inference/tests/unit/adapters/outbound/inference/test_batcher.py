import asyncio
import gc
import threading
import time
from unittest.mock import patch

import pytest

from src.domain.exceptions import ServiceOverloadedError
from src.adapters.outbound.inference.batcher import BatchingProxy
from concurrent.futures import ThreadPoolExecutor


class PredictBatchEngine:
    def __init__(self, results=None):
        self.calls = []
        self.results = results or [0.8, 0.2, 0.5, 0.9]

    def predict_batch(self, texts):
        self.calls.append(list(texts))
        return self.results[: len(texts)]


class FailingBatchEngine:
    def __init__(self):
        self.calls = 0

    def predict_batch(self, texts):
        self.calls += 1
        raise ValueError("Inference failed")


class BlockingBatchEngine:
    def __init__(self):
        self.started = threading.Event()
        self.release = threading.Event()
        self.calls = []

    def predict_batch(self, texts):
        self.calls.append(list(texts))
        self.started.set()
        self.release.wait(timeout=2)
        return [0.8 for _ in texts]


@pytest.mark.asyncio
async def test_batcher_predict_single():
    engine = PredictBatchEngine()
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(engine, batch_size=1, timeout=0.1, model_name="test", queue_max_size=8, executor=executor)
        await batcher.start()
    
        result = await batcher.predict("test input")
    
        assert result == 0.8
        assert engine.calls == [["test input"]]
    
        await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_groups_requests():
    engine = PredictBatchEngine()
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(engine, batch_size=2, timeout=0.5, model_name="test", queue_max_size=8, executor=executor)
        await batcher.start()
    
        result1, result2 = await asyncio.gather(
            batcher.predict("text1"),
            batcher.predict("text2"),
        )
    
        assert result1 == 0.8
        assert result2 == 0.2
        assert engine.calls == [["text1", "text2"]]
    
        await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_respects_timeout():
    engine = PredictBatchEngine()
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(engine, batch_size=5, timeout=0.1, model_name="test", queue_max_size=8, executor=executor)
        await batcher.start()
    
        start = time.monotonic()
        result = await batcher.predict("wait for me")
        duration = time.monotonic() - start
    
        assert duration >= 0.1
        assert result == 0.8
        assert engine.calls == [["wait for me"]]
    
        await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_handles_engine_exception():
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(FailingBatchEngine(), batch_size=1, timeout=0.1, model_name="test", queue_max_size=8, executor=executor)
        await batcher.start()
    
        with pytest.raises(ValueError, match="Inference failed"):
            await batcher.predict("boom")
    
        await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_rejects_when_queue_is_full():
    engine = PredictBatchEngine()
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(engine, batch_size=1, timeout=0.1, model_name="test", queue_max_size=1, executor=executor)
        await batcher.start()
    
        with patch.object(batcher.queue, "put_nowait", side_effect=asyncio.QueueFull):
            with pytest.raises(ServiceOverloadedError, match="queue is full"):
                await batcher.predict("boom")
    
        await batcher.shutdown()




@pytest.mark.asyncio
async def test_batcher_fails_queued_requests_during_shutdown():
    engine = BlockingBatchEngine()
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(engine, batch_size=1, timeout=0.01, model_name="test", queue_max_size=8, executor=executor, max_concurrent_batches=1)
        await batcher.start()
    
        first_request = asyncio.create_task(batcher.predict("text1"))
    
        await asyncio.to_thread(engine.started.wait, 1)
    
        second_request = asyncio.create_task(batcher.predict("text2"))
        shutdown_task = asyncio.create_task(batcher.shutdown())
    
        engine.release.set()
    
        assert await first_request == 0.8
        assert await second_request == 0.8
    
        await shutdown_task
        assert len(engine.calls) == 2


@pytest.mark.asyncio
async def test_batcher_shutdown_does_not_leave_unretrieved_future_exceptions():
    engine = BlockingBatchEngine()
    with ThreadPoolExecutor(max_workers=1) as executor:
        batcher = BatchingProxy(engine, batch_size=1, timeout=0.01, model_name="test", queue_max_size=8, executor=executor, max_concurrent_batches=1)
        await batcher.start()
    
        loop = asyncio.get_running_loop()
        contexts = []
        previous_handler = loop.get_exception_handler()
        loop.set_exception_handler(lambda _loop, context: contexts.append(context))
    
        try:
            first_request = asyncio.create_task(batcher.predict("text1"))
    
            await asyncio.to_thread(engine.started.wait, 1)
    
            second_request = asyncio.create_task(batcher.predict("text2"))
            shutdown_task = asyncio.create_task(batcher.shutdown())
    
            engine.release.set()
    
            assert await first_request == 0.8
            assert await second_request == 0.8
    
            await shutdown_task
            gc.collect()
            await asyncio.sleep(0)
    
            assert not any(
                context.get("message") == "Future exception was never retrieved"
                for context in contexts
            )
        finally:
            loop.set_exception_handler(previous_handler)
