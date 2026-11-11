import asyncio
import logging
import signal

from grpc import aio
from grpc_health.v1 import health, health_pb2, health_pb2_grpc

_SHUTDOWN_GRACE_SECONDS = 5

logger = logging.getLogger(__name__)


async def run_server(port: int) -> None:
    server, health_servicer = _build(port)
    await _serve_until_stopped(server, health_servicer)


def _build(port: int) -> tuple[aio.Server, health.aio.HealthServicer]:
    server = aio.server()
    health_servicer = health.aio.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)

    bound = server.add_insecure_port(f"[::]:{port}")
    if bound == 0:
        raise RuntimeError(f"failed to bind port {port}")
    return server, health_servicer


async def _serve_until_stopped(
    server: aio.Server, health_servicer: health.aio.HealthServicer
) -> None:
    await health_servicer.set("", health_pb2.HealthCheckResponse.SERVING)
    await server.start()
    logger.info("grpc server listening")

    await _wait_for_signal().wait()
    await health_servicer.enter_graceful_shutdown()
    await server.stop(grace=_SHUTDOWN_GRACE_SECONDS)
    logger.info("grpc server stopped")


def _wait_for_signal() -> asyncio.Event:
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            signal.signal(sig, lambda *_: stop.set())
    return stop
