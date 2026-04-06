import grpc
from concurrent import futures
import signal
import threading
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
        self.server = grpc.server(
            futures.ThreadPoolExecutor(max_workers=settings.GRPC_MAX_WORKERS),
            interceptors=[AuthInterceptor(), MonitoringInterceptor()]
        )
        
        servicer = AIService(analysis_service)
        ai_service_pb2_grpc.add_AIServiceServicer_to_server(servicer, self.server)
        add_health_check(self.server)
        
        self.done_event = threading.Event()

    def start(self):
        self.server.add_insecure_port(f'[::]:{self.port}')
        self.server.start()
        logger.info("server_started", port=self.port)
        
        signal.signal(signal.SIGTERM, self._stop_handler)
        signal.signal(signal.SIGINT, self._stop_handler)
        
        self.done_event.wait()

    def _stop_handler(self, signum, frame):
        logger.info("shutdown_signal_received")
        self.done_event.set()
        self.server.stop(grace=10)
