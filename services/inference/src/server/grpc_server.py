import grpc
from grpc import aio
import asyncio
import signal
from src.generated import ai_service_pb2_grpc
from src.server.servicers import AIService
from src.server.interceptors import AuthInterceptor, MonitoringInterceptor
from src.server.health import add_health_check
from src.config import settings
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
        add_health_check(self.server)
        
        self.done_event = asyncio.Event()

    async def start(self):
        self.server.add_insecure_port(f'[::]:{self.port}')
        await self.server.start()
        logger.info("server_started", port=self.port)
        
        loop = asyncio.get_running_loop()
        try:
            loop.add_signal_handler(signal.SIGTERM, self._stop_handler)
            loop.add_signal_handler(signal.SIGINT, self._stop_handler)
        except NotImplementedError:
            pass
        
        await self.done_event.wait()

    def _stop_handler(self):
        logger.info("shutdown_signal_received")
        self.done_event.set()
        asyncio.create_task(self._shutdown())

    async def _shutdown(self):
        await self.analysis_service.shutdown()
        await self.server.stop(grace=10)
