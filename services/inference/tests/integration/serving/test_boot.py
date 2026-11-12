"""The production gRPC boot on an ephemeral port: the health servicer answers
SERVING through a real channel, the stop event drains gracefully, and the
x-api-key gate rejects unkeyed calls before dispatch.
"""

import asyncio

import grpc
from grpc import aio
from grpc_health.v1 import health_pb2, health_pb2_grpc

from app.serving.generated import ai_service_pb2 as pb
from app.serving.generated import ai_service_pb2_grpc
from app.serving.server import _build, _serve_until_stopped

_BOOT_KEY = "boot-integration-key"


def test_the_production_boot_serves_health_on_an_ephemeral_port() -> None:
    asyncio.run(_serve_and_probe())


async def _serve_and_probe() -> None:
    stop = asyncio.Event()
    server, health_servicer, port = _build(0, api_key=_BOOT_KEY)
    serve = asyncio.create_task(_serve_until_stopped(server, health_servicer, stop))

    async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        await asyncio.wait_for(channel.channel_ready(), timeout=5.0)
        stub = health_pb2_grpc.HealthStub(channel)
        response = await stub.Check(health_pb2.HealthCheckRequest(service=""))
        assert response.status == health_pb2.HealthCheckResponse.SERVING

    stop.set()
    await serve


def test_the_gate_rejects_unkeyed_calls_and_admits_keyed_ones() -> None:
    asyncio.run(_probe_the_gate())


async def _probe_the_gate() -> None:
    stop = asyncio.Event()
    server, health_servicer, port = _build(0, api_key=_BOOT_KEY)
    serve = asyncio.create_task(_serve_until_stopped(server, health_servicer, stop))

    async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        detect = ai_service_pb2_grpc.AIServiceStub(channel).Detect

        unkeyed = await _detect_code(detect, pb.DetectRequest(text="x"))
        assert unkeyed == grpc.StatusCode.UNAUTHENTICATED

        wrong = await _detect_code(
            detect, pb.DetectRequest(text="x"), api_key="wrong-key-at-least-16"
        )
        assert wrong == grpc.StatusCode.UNAUTHENTICATED

        keyed = await _detect_code(detect, pb.DetectRequest(text="x"), api_key=_BOOT_KEY)
        assert keyed == grpc.StatusCode.UNIMPLEMENTED

        health = health_pb2_grpc.HealthStub(channel)
        response = await health.Check(health_pb2.HealthCheckRequest(service=""))
        assert response.status == health_pb2.HealthCheckResponse.SERVING

    stop.set()
    await serve


async def _detect_code(detect, request, api_key: str | None = None) -> grpc.StatusCode:
    """One Detect call; the real channel surfaces the outcome through AioRpcError."""
    metadata = () if api_key is None else (("x-api-key", api_key),)
    try:
        await detect(request, metadata=metadata)
    except aio.AioRpcError as error:
        return error.code()
    raise AssertionError("Detect answered OK with no servicer registered")
