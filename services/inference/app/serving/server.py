import asyncio
import logging
import signal

from grpc import aio
from grpc_health.v1 import health, health_pb2, health_pb2_grpc

from ..inference.analysis import DocumentAnalysis
from .auth import ApiKeyAuthInterceptor
from .generated import ai_service_pb2 as pb
from .generated import ai_service_pb2_grpc as pb_grpc
from .servicer import AIServiceServicer

# How long the server waits for the documents in flight when it stops.
_SHUTDOWN_GRACE_SECONDS = 120

# The service's own name in the health registry, taken from the contract.
_HEALTH_SERVICE = pb.DESCRIPTOR.services_by_name["AIService"].full_name

logger = logging.getLogger(__name__)


async def run_server(
    port: int, api_key: str, analysis: DocumentAnalysis, max_inflight_requests: int
) -> None:
    server, health_servicer, _ = _build(port, api_key, analysis, max_inflight_requests)
    await _serve_until_stopped(server, health_servicer, _wait_for_signal(), analysis)


def _build(
    port: int, api_key: str, analysis: DocumentAnalysis, max_inflight_requests: int
) -> tuple[aio.Server, health.aio.HealthServicer, int]:
    server = aio.server(
        interceptors=[ApiKeyAuthInterceptor(api_key)],
        maximum_concurrent_rpcs=max_inflight_requests,
    )
    health_servicer = health.aio.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    pb_grpc.add_AIServiceServicer_to_server(AIServiceServicer(analysis), server)

    bound = server.add_insecure_port(f"[::]:{port}")
    if bound == 0:
        raise RuntimeError(f"failed to bind port {port}")
    return server, health_servicer, bound


async def _serve_until_stopped(
    server: aio.Server,
    health_servicer: health.aio.HealthServicer,
    stop: asyncio.Event,
    analysis: DocumentAnalysis,
) -> None:
    await health_servicer.set("", health_pb2.HealthCheckResponse.SERVING)
    await health_servicer.set(_HEALTH_SERVICE, health_pb2.HealthCheckResponse.SERVING)
    await server.start()
    logger.info("grpc server listening")

    await stop.wait()
    analysis.begin_draining()
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
