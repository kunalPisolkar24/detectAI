import asyncio
import os
import time
import socket
from typing import List

import grpc
import pytest
import jwt
from prometheus_client import REGISTRY

from src.infrastructure.config import Settings
import src.infrastructure.config as config_module
from src.application.services.document_analysis import DocumentAnalysisService
from src.application.services.chunking import build_chunk_planner
from src.application.services.validation import InputValidator
from src.application.services.aggregation import ResultAggregator
from src.adapters.inbound.grpc.grpc_server import GRPCServer
from src.infrastructure.metrics import PrometheusTelemetryReporter
from src.application.ports.outbound.inference import ISyncBatchInferenceEngine

class DummyEngine(ISyncBatchInferenceEngine):
    def __init__(self):
        self.batch_count = 0
        self.total_samples = 0
        self.last_batch_size = 0

    def predict_batch(self, texts: List[str]) -> List[float]:
        self.batch_count += 1
        self.total_samples += len(texts)
        self.last_batch_size = len(texts)
        # Simulate some processing time
        time.sleep(0.01)
        return [0.5] * len(texts)

def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('', 0))
        return s.getsockname()[1]

@pytest.fixture
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture
def test_settings():
    settings = Settings(
        API_KEY="integration-test-secret",
        GRPC_PORT=get_free_port(),
        METRICS_PORT=get_free_port(),
        BATCH_SIZE=4,
        BATCH_TIMEOUT=0.1,
        BATCH_QUEUE_MAX_SIZE=16,
        MAX_INFLIGHT_DOC_CHUNKS=4,
        MAX_TEXT_LENGTH=1000,
        CHUNK_TOKEN_LIMIT=10,
        CHUNK_TOKEN_STRIDE=5,
        MAX_GLOBAL_TOKENS=5000,
        MAX_CONCURRENT_BATCHES=2,
    )
    return settings

@pytest.fixture
def auth_token(test_settings):
    return jwt.encode(
        {"sub": "integration-test-user", "iat": int(time.time())},
        test_settings.API_KEY,
        algorithm="HS256",
    )

@pytest.fixture
async def integration_app(test_settings, monkeypatch):
    # Apply settings to modules
    import src.adapters.inbound.grpc.grpc_server as grpc_server_module
    import src.adapters.inbound.grpc.interceptors as interceptors_module
    
    monkeypatch.setattr(config_module, "settings", test_settings)
    monkeypatch.setattr(grpc_server_module, "settings", test_settings)
    monkeypatch.setattr(interceptors_module, "settings", test_settings)

    from src.adapters.outbound.inference.batcher import BatchingProxy
    import concurrent.futures

    executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    dummy_engine = DummyEngine()
    
    batcher = BatchingProxy(
        dummy_engine,
        test_settings.BATCH_SIZE,
        test_settings.BATCH_TIMEOUT,
        "spark",
        test_settings.BATCH_QUEUE_MAX_SIZE,
        executor=executor,
        max_concurrent_batches=test_settings.MAX_CONCURRENT_BATCHES,
    )
    await batcher.start()

    analysis_service = DocumentAnalysisService(
        engines={"spark": batcher},
        health_reporters={"spark": batcher},
        planners={
            "spark": build_chunk_planner(None, test_settings.CHUNK_TOKEN_LIMIT, test_settings.CHUNK_TOKEN_STRIDE, test_settings.MAX_GLOBAL_TOKENS)
        },
        validator=InputValidator(test_settings.MAX_TEXT_CHARS),
        aggregator=ResultAggregator(test_settings.CHUNK_TOKEN_STRIDE),
        max_inflight_chunks=test_settings.MAX_INFLIGHT_DOC_CHUNKS,
        telemetry=PrometheusTelemetryReporter(),
    )

    server = GRPCServer(analysis_service)
    server_task = asyncio.create_task(server.start())
    
    # Wait for server to be ready
    await asyncio.sleep(0.5)

    yield {
        "server": server,
        "analysis_service": analysis_service,
        "dummy_engine": dummy_engine,
        "batcher": batcher,
        "port": test_settings.GRPC_PORT,
    }

    server._stop_handler()
    await server_task
    await batcher.shutdown()
    executor.shutdown(wait=True)
