import asyncio
import logging
import signal

from grpc import aio
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from grpc_reflection.v1alpha import reflection

from ..inference.analysis import DocumentAnalysis
from ..observability import NullObservability
from ..observability.contract import Observability
from .auth import HEALTH_METHODS, ApiKeyAuthInterceptor
from .generated import ai_service_pb2 as pb
from .generated import ai_service_pb2_grpc as pb_grpc
from .servicer import AIServiceServicer

# How long the server waits for the documents in flight when it stops.
_SHUTDOWN_GRACE_SECONDS = 120

# The service's own name in the health and reflection registries, taken from the contract.
_SERVICE_NAME = pb.DESCRIPTOR.services_by_name["AIService"].full_name

# The reflection method: the schema only, no inference capacity behind it.
_REFLECTION_METHOD = f"/{reflection.SERVICE_NAME}/ServerReflectionInfo"

logger = logging.getLogger(__name__)


async def run_server(
    port: int,
    api_key: str,
    analysis: DocumentAnalysis,
    max_inflight_requests: int,
    enable_reflection: bool = False,
    server_interceptor: aio.ServerInterceptor | None = None,
    observability: Observability | None = None,
) -> None:
    server, health_servicer, _ = _build(
        port,
        api_key,
        analysis,
        max_inflight_requests,
        enable_reflection,
        server_interceptor,
        observability,
    )
    await _serve_until_stopped(server, health_servicer, _wait_for_signal(), analysis)


def _build(
    port: int,
    api_key: str,
    analysis: DocumentAnalysis,
    max_inflight_requests: int,
    enable_reflection: bool = False,
    server_interceptor: aio.ServerInterceptor | None = None,
    observability: Observability | None = None,
) -> tuple[aio.Server, health.aio.HealthServicer, int]:
    open_methods = HEALTH_METHODS
    if enable_reflection:
        open_methods = open_methods | {_REFLECTION_METHOD}
    seam = observability or NullObservability()
    interceptors: list[aio.ServerInterceptor] = []
    if server_interceptor is not None:
        # Outermost: the trace must wrap the auth gate, or a rejected call leaves no trace.
        interceptors.append(server_interceptor)
    interceptors.append(ApiKeyAuthInterceptor(api_key, open_methods, seam))
    server = aio.server(
        interceptors=interceptors,
        maximum_concurrent_rpcs=max_inflight_requests,
    )
    health_servicer = health.aio.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    pb_grpc.add_AIServiceServicer_to_server(
        AIServiceServicer(analysis, seam), server
    )
    if enable_reflection:
        reflection.enable_server_reflection([_SERVICE_NAME], server)

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
    await health_servicer.set(_SERVICE_NAME, health_pb2.HealthCheckResponse.SERVING)
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
