import asyncio
import logging
import os
import signal

from grpc import aio
from grpc_health.v1 import health, health_pb2, health_pb2_grpc

_SHUTDOWN_GRACE_SECONDS = 5


async def serve() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    logger = logging.getLogger(__name__)

    server = aio.server()
    health_servicer = health.aio.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    await health_servicer.set("", health_pb2.HealthCheckResponse.SERVING)

    port = int(os.environ.get("GRPC_PORT", "50051"))
    bound = server.add_insecure_port(f"[::]:{port}")
    if bound == 0:
        raise RuntimeError(f"failed to bind port {port}")

    await server.start()
    logger.info("grpc server listening on port %s", bound)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            signal.signal(sig, lambda *_: stop.set())

    await stop.wait()
    await health_servicer.enter_graceful_shutdown()
    await server.stop(grace=_SHUTDOWN_GRACE_SECONDS)
    logger.info("grpc server stopped")


if __name__ == "__main__":
    asyncio.run(serve())
