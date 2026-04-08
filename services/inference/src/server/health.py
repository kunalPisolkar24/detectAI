import asyncio

import structlog
from grpc_health.v1 import health
from grpc_health.v1 import health_pb2
from grpc_health.v1 import health_pb2_grpc

from src.core.interfaces import BatcherHealthStatus

logger = structlog.get_logger()

_SERVICE_NAMES = ("", "aidetection.AIService")
_POLL_INTERVAL_SECONDS = 5


class HealthMonitor:
    def __init__(self, analysis_service):
        self.analysis_service = analysis_service
        self.health_servicer = health.aio.HealthServicer()
        self._task: asyncio.Task | None = None
        self._is_shutting_down = False
        self._last_state: int | None = None
        self._last_reason: str | None = None

    async def start(self) -> None:
        await self._publish_state()
        if self._task is None:
            self._task = asyncio.create_task(self._watchtower(), name="grpc-health-watchtower")

    async def shutdown(self) -> None:
        self._is_shutting_down = True
        await self._publish_state()

        if self._task is None:
            return

        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    async def _watchtower(self) -> None:
        try:
            while True:
                await self._publish_state()
                await asyncio.sleep(_POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise

    async def _publish_state(self) -> None:
        state, reason = self._resolve_state()
        for service_name in _SERVICE_NAMES:
            await self.health_servicer.set(service_name, state)

        if state != self._last_state or reason != self._last_reason:
            if state == health_pb2.HealthCheckResponse.NOT_SERVING:
                logger.warning("health_state_changed", state="NOT_SERVING", reason=reason)
            else:
                logger.info("health_state_changed", state="SERVING")

        self._last_state = state
        self._last_reason = reason

    def _resolve_state(self) -> tuple[int, str | None]:
        if self._is_shutting_down:
            return health_pb2.HealthCheckResponse.NOT_SERVING, "shutdown_in_progress"

        for reporter in getattr(self.analysis_service, "health_reporters", {}).values():
            snapshot = reporter.health_snapshot()
            if snapshot.status != BatcherHealthStatus.SERVING:
                return health_pb2.HealthCheckResponse.NOT_SERVING, snapshot.failure_reason

        return health_pb2.HealthCheckResponse.SERVING, None


def add_health_check(server, analysis_service) -> HealthMonitor:
    monitor = HealthMonitor(analysis_service)
    health_pb2_grpc.add_HealthServicer_to_server(monitor.health_servicer, server)
    return monitor
