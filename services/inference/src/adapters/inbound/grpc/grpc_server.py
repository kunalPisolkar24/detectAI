import asyncio
import signal

from grpc import aio

from src.adapters.inbound.grpc.health import add_health_check
from src.adapters.inbound.grpc.interceptors import AuthInterceptor, MonitoringInterceptor
from src.adapters.inbound.grpc.servicers import AIService
from src.generated import ai_service_pb2_grpc
from src.infrastructure.config import settings
import structlog

logger = structlog.get_logger()


class GRPCServer:
    def __init__(self, analysis_service):
        self.port = settings.GRPC_PORT
        self.analysis_service = analysis_service
        # Monitoring outer ensures auth failures are also recorded in RED
        self.server = aio.server(
            interceptors=[MonitoringInterceptor(), AuthInterceptor()],
            options=[
                ("grpc.max_concurrent_streams", 100),
                ("grpc.max_send_message_length", 1024 * 1024 * 4),
                ("grpc.max_receive_message_length", 512 * 1024),
                ("grpc.so_reuseport", 0),
            ],
            maximum_concurrent_rpcs=settings.GRPC_MAX_WORKERS,
        )

        servicer = AIService(analysis_service)
        ai_service_pb2_grpc.add_AIServiceServicer_to_server(servicer, self.server)
        self.health_monitor = add_health_check(self.server, self.analysis_service)
        self.done_event = asyncio.Event()
        self._shutdown_task: asyncio.Task | None = None
        self._shutting_down = False
        self._shutdown_lock = asyncio.Lock()

    async def start(self):
        loop = asyncio.get_running_loop()
        # Install signal handlers before serving to avoid window
        try:
            loop.add_signal_handler(signal.SIGTERM, self._stop_handler)
            loop.add_signal_handler(signal.SIGINT, self._stop_handler)
        except NotImplementedError:
            try:
                signal.signal(signal.SIGTERM, lambda *_: self._stop_handler())  # type: ignore[arg-type]
                signal.signal(signal.SIGINT, lambda *_: self._stop_handler())  # type: ignore[arg-type]
            except Exception:
                pass

        # Health must be SERVING before accepting traffic to avoid NOT_FOUND probes
        await self.health_monitor.start()
        self.server.add_insecure_port(f"[::]:{self.port}")
        await self.server.start()
        logger.info("server_started", port=self.port)

        await self.done_event.wait()
        async with self._shutdown_lock:
            if self._shutdown_task is None:
                self._shutdown_task = asyncio.create_task(self._shutdown(), name="grpc-server-shutdown")
            task = self._shutdown_task
        await task

    def _stop_handler(self):
        if self._shutting_down:
            return

        self._shutting_down = True
        logger.info("shutdown_signal_received")
        self.done_event.set()
        # Single-flight shutdown task creation
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._shutdown_task is None or self._shutdown_task.done():
            self._shutdown_task = loop.create_task(self._shutdown(), name="grpc-server-shutdown")

    async def _shutdown(self):
        async with self._shutdown_lock:
            if self._shutting_down:
                logger.info("server_shutdown_started")
            else:
                self._shutting_down = True
                logger.info("server_shutdown_started", trigger="explicit")

            # Correct order: NOT_SERVING -> stop server (drain grace) -> shutdown batchers
            try:
                await self.health_monitor.shutdown()
            except Exception as e:
                logger.error("health_shutdown_failed", error=str(e), exc_info=True)
            try:
                await self.server.stop(grace=10)
                logger.info("server_stop_completed")
            except Exception as e:
                logger.error("server_stop_failed", error=str(e), exc_info=True)
            try:
                await self.analysis_service.shutdown()
            except Exception as e:
                logger.error("analysis_shutdown_failed", error=str(e), exc_info=True)
            logger.info("server_shutdown_completed")
