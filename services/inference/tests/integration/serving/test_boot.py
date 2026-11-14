"""The production gRPC boot on an ephemeral port: the health servicer answers
SERVING through a real channel, the stop event drains gracefully, and the
x-api-key gate rejects unkeyed calls before dispatch.
"""

import asyncio
from collections.abc import AsyncIterator

import grpc
from grpc import aio
from grpc_health.v1 import health_pb2, health_pb2_grpc

from app.inference.analysis import DocumentAnalysis
from app.serving.generated import ai_service_pb2 as pb
from app.serving.generated import ai_service_pb2_grpc
from app.serving.server import _build, _serve_until_stopped

_BOOT_KEY = "boot-integration-key"


async def _booted(analysis: DocumentAnalysis) -> AsyncIterator[tuple[int, asyncio.Task]]:
    """The server on an ephemeral port, stopped whatever the probe does."""
    stop = asyncio.Event()
    server, health_servicer, port = _build(0, api_key=_BOOT_KEY, analysis=analysis)
    serve = asyncio.create_task(_serve_until_stopped(server, health_servicer, stop, analysis))
    try:
        yield port, serve
    finally:
        stop.set()
        await serve


def test_the_production_boot_serves_health_on_an_ephemeral_port(
    analysis: DocumentAnalysis,
) -> None:
    asyncio.run(_serve_and_probe(analysis))


async def _serve_and_probe(analysis: DocumentAnalysis) -> None:
    async for port, _serve in _booted(analysis):
        async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            await asyncio.wait_for(channel.channel_ready(), timeout=5.0)
            stub = health_pb2_grpc.HealthStub(channel)
            response = await stub.Check(health_pb2.HealthCheckRequest(service=""))
            assert response.status == health_pb2.HealthCheckResponse.SERVING
            named = await stub.Check(
                health_pb2.HealthCheckRequest(service="inference.v1.AIService")
            )
            assert named.status == health_pb2.HealthCheckResponse.SERVING


def test_the_gate_rejects_unkeyed_calls_and_admits_keyed_ones(
    analysis: DocumentAnalysis,
) -> None:
    asyncio.run(_probe_the_gate(analysis))


async def _probe_the_gate(analysis: DocumentAnalysis) -> None:
    async for port, _serve in _booted(analysis):
        async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            detect = ai_service_pb2_grpc.AIServiceStub(channel).Detect

            unkeyed = await _detect_code(detect, pb.DetectRequest(text="x"))
            assert unkeyed == grpc.StatusCode.UNAUTHENTICATED

            wrong = await _detect_code(
                detect, pb.DetectRequest(text="x"), api_key="wrong-key-at-least-16"
            )
            assert wrong == grpc.StatusCode.UNAUTHENTICATED

            keyed = await _detect_code(detect, pb.DetectRequest(text="x"), api_key=_BOOT_KEY)
            assert keyed is None


async def _detect_code(
    detect, request, api_key: str | None = None
) -> grpc.StatusCode | None:
    """One Detect call; the real channel surfaces the outcome through AioRpcError."""
    metadata = () if api_key is None else (("x-api-key", api_key),)
    try:
        await detect(request, metadata=metadata)
    except aio.AioRpcError as error:
        return error.code()
    return None


def test_the_streaming_rpc_answers_started_progress_and_the_result(
    analysis: DocumentAnalysis,
) -> None:
    asyncio.run(_stream_a_document(analysis))


async def _stream_a_document(analysis: DocumentAnalysis) -> None:
    async for port, _serve in _booted(analysis):
        async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
            analyze = ai_service_pb2_grpc.AIServiceStub(channel).AnalyzeDocument
            request = pb.AnalyzeDocumentRequest(text="a handful of words to analyse")
            events = [
                event
                async for event in analyze(request, metadata=(("x-api-key", _BOOT_KEY),))
            ]

            assert [event.WhichOneof("event") for event in events] == [
                "started",
                "progress",
                "result",
            ]
            assert events[0].started.total_chars == len(request.text)
            assert events[0].started.total_chunks == 1
            assert events[-1].result.model_id == "spark"
