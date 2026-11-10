import asyncio

import pytest

from src.application.services.dispatcher import ConcurrencyDispatcher
from src.domain.models import DocumentChunk


def _chunks(texts):
    chunks = []
    pos = 0
    for i, text in enumerate(texts):
        chunks.append(
            DocumentChunk(index=i, text=text, token_count=1, char_start=pos, char_end=pos + len(text))
        )
        pos += len(text) + 1
    return chunks


class TrackingEngine:
    def __init__(self):
        self.inflight = 0
        self.peak = 0

    async def predict(self, text):
        self.inflight += 1
        self.peak = max(self.peak, self.inflight)
        try:
            await asyncio.sleep(0.01)
            return 0.5
        finally:
            self.inflight -= 1


class FailFirstEngine:
    def __init__(self):
        self.started = []

    async def predict(self, text):
        self.started.append(text)
        if text == "fail":
            raise RuntimeError("boom")
        await asyncio.sleep(5)
        return 0.5


@pytest.mark.asyncio
async def test_pool_bounds_inflight_workers():
    engine = TrackingEngine()
    dispatcher = ConcurrencyDispatcher(3)
    chunks = _chunks([f"text{i}" for i in range(20)])

    seen = {}
    async for idx, prob in dispatcher.execute_progressively(engine, chunks):
        seen[idx] = prob

    assert len(seen) == 20
    assert set(seen) == set(range(20))
    assert all(prob == 0.5 for prob in seen.values())
    assert engine.peak <= 3


@pytest.mark.asyncio
async def test_pool_yields_nothing_for_empty_chunks():
    dispatcher = ConcurrencyDispatcher(2)

    assert [event async for event in dispatcher.execute_progressively(TrackingEngine(), [])] == []


@pytest.mark.asyncio
async def test_pool_reports_client_disconnect_as_cancelled():
    dispatcher = ConcurrencyDispatcher(2)
    chunks = _chunks(["one", "two"])

    with pytest.raises(asyncio.CancelledError):
        async for _ in dispatcher.execute_progressively(engine=TrackingEngine(), chunks=chunks, request_is_active=lambda: False):
            pass


@pytest.mark.asyncio
async def test_pool_does_not_start_pending_chunks_after_failure():
    engine = FailFirstEngine()
    dispatcher = ConcurrencyDispatcher(1)
    chunks = _chunks(["fail", "slow"])

    with pytest.raises(RuntimeError, match="boom"):
        async for _ in dispatcher.execute_progressively(engine, chunks):
            pass

    assert engine.started == ["fail"]
