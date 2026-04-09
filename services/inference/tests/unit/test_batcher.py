import asyncio
import threading
import time
from unittest.mock import patch

import pytest

from src.core.interfaces import BatcherHealthStatus
from src.core.exceptions import ServiceOverloadedError
from src.inference.batcher import BatchingProxy


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
    batcher = BatchingProxy(engine, batch_size=1, timeout=0.1, model_name="test", queue_max_size=8)
    await batcher.start()

    result = await batcher.predict("test input")

    assert result == 0.8
    assert engine.calls == [["test input"]]

    await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_groups_requests():
    engine = PredictBatchEngine()
    batcher = BatchingProxy(engine, batch_size=2, timeout=0.5, model_name="test", queue_max_size=8)
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
    batcher = BatchingProxy(engine, batch_size=5, timeout=0.1, model_name="test", queue_max_size=8)
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
    batcher = BatchingProxy(FailingBatchEngine(), batch_size=1, timeout=0.1, model_name="test", queue_max_size=8)
    await batcher.start()

    with pytest.raises(ValueError, match="Inference failed"):
        await batcher.predict("boom")

    await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_rejects_when_queue_is_full():
    engine = PredictBatchEngine()
    batcher = BatchingProxy(engine, batch_size=1, timeout=0.1, model_name="test", queue_max_size=1)
    await batcher.start()

    with patch.object(batcher.queue, "put_nowait", side_effect=asyncio.QueueFull):
        with pytest.raises(ServiceOverloadedError, match="queue is full"):
            await batcher.predict("boom")

    await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_opens_circuit_after_repeated_failures():
    batcher = BatchingProxy(FailingBatchEngine(), batch_size=1, timeout=0.01, model_name="test", queue_max_size=8)
    await batcher.start()

    for _ in range(3):
        with pytest.raises(ValueError, match="Inference failed"):
            await batcher.predict("boom")

    with pytest.raises(ServiceOverloadedError, match="circuit is open"):
        await batcher.predict("boom")

    await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_reports_open_circuit_in_health_snapshot():
    batcher = BatchingProxy(FailingBatchEngine(), batch_size=1, timeout=0.01, model_name="test", queue_max_size=8)
    await batcher.start()

    for _ in range(3):
        with pytest.raises(ValueError, match="Inference failed"):
            await batcher.predict("boom")

    snapshot = batcher.health_snapshot()

    assert snapshot.status == BatcherHealthStatus.CIRCUIT_OPEN
    assert snapshot.circuit_open_remaining is not None

    await batcher.shutdown()


@pytest.mark.asyncio
async def test_batcher_fails_queued_requests_during_shutdown():
    engine = BlockingBatchEngine()
    batcher = BatchingProxy(engine, batch_size=1, timeout=0.01, model_name="test", queue_max_size=8)
    await batcher.start()

    first_request = asyncio.create_task(batcher.predict("text1"))

    await asyncio.to_thread(engine.started.wait, 1)

    second_request = asyncio.create_task(batcher.predict("text2"))
    shutdown_task = asyncio.create_task(batcher.shutdown())

    engine.release.set()

    assert await first_request == 0.8
    with pytest.raises(ServiceOverloadedError, match="shutting down"):
        await second_request

    await shutdown_task
    assert engine.calls == [["text1"]]
