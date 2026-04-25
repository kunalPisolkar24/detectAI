import grpc
from grpc import aio
import asyncio
import signal
from src.generated import ai_service_pb2_grpc
from src.adapters.inbound.grpc.servicers import AIService
from src.adapters.inbound.grpc.interceptors import AuthInterceptor, MonitoringInterceptor
from src.adapters.inbound.grpc.health import add_health_check
from src.infrastructure.config import settings
import structlog

logger = structlog.get_logger()

class GRPCServer:
    def __init__(self, analysis_service):
        self.port = settings.GRPC_PORT
        self.analysis_service = analysis_service
        self.server = aio.server(
            interceptors=[AuthInterceptor(), MonitoringInterceptor()]
        )

        servicer = AIService(analysis_service)
        ai_service_pb2_grpc.add_AIServiceServicer_to_server(servicer, self.server)
        self.health_monitor = add_health_check(self.server, self.analysis_service)
        self.done_event = asyncio.Event()
        self._shutdown_task: asyncio.Task | None = None
        self._shutting_down = False

    async def start(self):
        self.server.add_insecure_port(f"[::]:{self.port}")
        await self.server.start()
        await self.health_monitor.start()
        logger.info("server_started", port=self.port)

        loop = asyncio.get_running_loop()
        try:
            loop.add_signal_handler(signal.SIGTERM, self._stop_handler)
            loop.add_signal_handler(signal.SIGINT, self._stop_handler)
        except NotImplementedError:
            pass

        await self.done_event.wait()
        if self._shutdown_task is None:
            self._shutdown_task = asyncio.create_task(self._shutdown(), name="grpc-server-shutdown")
        await self._shutdown_task

    def _stop_handler(self):
        if self._shutting_down:
            return

        self._shutting_down = True
        logger.info("shutdown_signal_received")
        self.done_event.set()
        if self._shutdown_task is None:
            self._shutdown_task = asyncio.create_task(self._shutdown(), name="grpc-server-shutdown")

    async def _shutdown(self):
        if self._shutting_down:
            logger.info("server_shutdown_started")
        else:
            self._shutting_down = True
            logger.info("server_shutdown_started", trigger="explicit")

        try:
            await self.health_monitor.shutdown()
            await self.analysis_service.shutdown()
        finally:
            await self.server.stop(grace=10)
            logger.info("server_shutdown_completed")
