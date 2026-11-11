"""The production gRPC boot on an ephemeral port: the health servicer answers
SERVING through a real channel, and the stop event drains gracefully.
"""

import asyncio

from grpc import aio
from grpc_health.v1 import health_pb2, health_pb2_grpc

from app.serving.server import _build, _serve_until_stopped


def test_the_production_boot_serves_health_on_an_ephemeral_port() -> None:
    asyncio.run(_serve_and_probe())


async def _serve_and_probe() -> None:
    stop = asyncio.Event()
    server, health_servicer, port = _build(0)
    serve = asyncio.create_task(_serve_until_stopped(server, health_servicer, stop))

    async with aio.insecure_channel(f"127.0.0.1:{port}") as channel:
        await asyncio.wait_for(channel.channel_ready(), timeout=5.0)
        stub = health_pb2_grpc.HealthStub(channel)
        response = await stub.Check(health_pb2.HealthCheckRequest(service=""))
        assert response.status == health_pb2.HealthCheckResponse.SERVING

    stop.set()
    await serve
