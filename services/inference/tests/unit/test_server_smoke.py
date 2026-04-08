import asyncio

import grpc
import pytest
from grpc_health.v1 import health_pb2, health_pb2_grpc

from src.generated import ai_service_pb2, ai_service_pb2_grpc
from src.inference.document_types import DocumentProgress, DocumentScore, DocumentStarted
from src.server.grpc_server import GRPCServer


async def collect_stream(stream):
    return [event async for event in stream]


class SmokeEngine:
    def __init__(self):
        self.queue = asyncio.Queue(maxsize=4)
        self.worker_task = asyncio.create_task(asyncio.Event().wait())
        self.shutdown_flag = False


class SmokeAnalysisService:
    def __init__(self):
        self.engine = SmokeEngine()
        self.engines = {"spark": self.engine}

    async def analyze(self, text, model_key, request_is_active=None):
        assert model_key == "spark"
        assert request_is_active is None or request_is_active() is True
        return DocumentScore(ai_probability=0.91, total_chunks=1, total_chars=len(text))

    async def stream(self, text, model_key, request_is_active=None):
        assert model_key == "spark"
        assert request_is_active is None or request_is_active() is True
        yield DocumentStarted(total_chars=len(text), total_chunks=2)
        yield DocumentProgress(processed_chunks=1, total_chunks=2)
        yield DocumentScore(ai_probability=0.88, total_chunks=2, total_chars=len(text))

    async def shutdown(self):
        self.engine.shutdown_flag = True
        self.engine.worker_task.cancel()
        await asyncio.gather(self.engine.worker_task, return_exceptions=True)


@pytest.mark.asyncio
async def test_grpc_server_smoke_flow(test_settings, auth_token):
    analysis_service = SmokeAnalysisService()
    server = GRPCServer(analysis_service)
    server_task = asyncio.create_task(server.start())
    channel = grpc.aio.insecure_channel(f"127.0.0.1:{test_settings.GRPC_PORT}")

    try:
        await asyncio.wait_for(channel.channel_ready(), timeout=2)

        health_stub = health_pb2_grpc.HealthStub(channel)
        ai_stub = ai_service_pb2_grpc.AIServiceStub(channel)

        health_response = await health_stub.Check(health_pb2.HealthCheckRequest())
        assert health_response.status == health_pb2.HealthCheckResponse.SERVING

        with pytest.raises(grpc.aio.AioRpcError) as unauthenticated:
            await ai_stub.Detect(ai_service_pb2.PredictRequest(text="sample", model_id="spark"))
        assert unauthenticated.value.code() == grpc.StatusCode.UNAUTHENTICATED

        with pytest.raises(grpc.aio.AioRpcError) as invalid_token:
            await ai_stub.Detect(
                ai_service_pb2.PredictRequest(text="sample", model_id="spark"),
                metadata=(("authorization", "Bearer invalid"),),
            )
        assert invalid_token.value.code() == grpc.StatusCode.UNAUTHENTICATED

        detect_response = await ai_stub.Detect(
            ai_service_pb2.PredictRequest(text="sample", model_id="spark"),
            metadata=(("authorization", f"Bearer {auth_token}"),),
        )
        assert detect_response.model_name == "Spark"
        assert detect_response.is_ai_generated is True

        stream = ai_stub.AnalyzeDocument(
            ai_service_pb2.AnalyzeDocumentRequest(text="sample text", model_id="spark"),
            metadata=(("authorization", f"Bearer {auth_token}"),),
        )
        events = await collect_stream(stream)

        assert len(events) == 3
        assert events[0].started.total_chunks == 2
        assert events[1].progress.processed_chunks == 1
        assert events[2].final.model_name == "Spark"

        server._stop_handler()
        await asyncio.wait_for(server_task, timeout=2)
    finally:
        await channel.close()
        if not server_task.done():
            server._stop_handler()
            await asyncio.wait_for(server_task, timeout=2)
