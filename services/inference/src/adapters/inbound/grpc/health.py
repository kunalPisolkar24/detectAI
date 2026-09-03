import asyncio

import structlog
from grpc_health.v1 import health
from grpc_health.v1 import health_pb2
from grpc_health.v1 import health_pb2_grpc

from src.domain.models import BatcherHealthSnapshot, BatcherHealthStatus
from src.infrastructure.metrics import set_engine_health, set_service_health

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
        while True:
            try:
                await self._publish_state()
                await asyncio.sleep(_POLL_INTERVAL_SECONDS)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error("health_watchtower_error", error=str(e), exc_info=True)
                await asyncio.sleep(_POLL_INTERVAL_SECONDS)

    async def _publish_state(self) -> None:
        snapshots = self._collect_snapshots()
        state, reason = self._resolve_state(snapshots)
        # Atomic publish for both service names
        try:
            await asyncio.gather(
                *(self.health_servicer.set(name, state) for name in _SERVICE_NAMES)
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error("health_publish_failed", error=str(e), exc_info=True)

        try:
            set_service_health(state, reason)
        except Exception as e:
            logger.warning("health_metric_failed", error=str(e))
        for model_name, snapshot in snapshots.items():
            try:
                set_engine_health(model_name, snapshot)
            except Exception as e:
                logger.warning("engine_health_metric_failed", model=model_name, error=str(e))

        if state != self._last_state or reason != self._last_reason:
            if state == health_pb2.HealthCheckResponse.NOT_SERVING:
                logger.warning("health_state_changed", state="NOT_SERVING", reason=reason)
            else:
                logger.info("health_state_changed", state="SERVING")

        self._last_state = state
        self._last_reason = reason

    def _collect_snapshots(self) -> dict[str, BatcherHealthSnapshot]:
        return {
            model_name: reporter.health_snapshot()
            for model_name, reporter in getattr(self.analysis_service, "health_reporters", {}).items()
        }

    def _resolve_state(self, snapshots: dict[str, BatcherHealthSnapshot] | None = None) -> tuple[int, str | None]:
        if self._is_shutting_down:
            return health_pb2.HealthCheckResponse.NOT_SERVING, "shutdown_in_progress"

        if snapshots is None:
            effective_snapshots = self._collect_snapshots()
        else:
            effective_snapshots = snapshots

        # Empty reporters likely misconfiguration — treat as NOT_SERVING
        if not effective_snapshots:
            return health_pb2.HealthCheckResponse.NOT_SERVING, "service_initializing"

        for snapshot in effective_snapshots.values():
            # QUEUE_FULL is transient load, should not flip health to NOT_SERVING (shed via RESOURCE_EXHAUSTED)
            if snapshot.status == BatcherHealthStatus.QUEUE_FULL:
                continue
            if snapshot.status != BatcherHealthStatus.SERVING:
                return health_pb2.HealthCheckResponse.NOT_SERVING, snapshot.failure_reason

        return health_pb2.HealthCheckResponse.SERVING, None


def add_health_check(server, analysis_service) -> HealthMonitor:
    monitor = HealthMonitor(analysis_service)
    health_pb2_grpc.add_HealthServicer_to_server(monitor.health_servicer, server)
    return monitor
