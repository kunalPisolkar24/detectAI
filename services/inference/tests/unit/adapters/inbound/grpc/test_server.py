import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from grpc_health.v1 import health_pb2

from src.domain.models import BatcherHealthSnapshot, BatcherHealthStatus
from src.adapters.inbound.grpc.grpc_server import GRPCServer
from src.adapters.inbound.grpc.health import HealthMonitor, add_health_check


@pytest.mark.asyncio
async def test_server_start_waits_for_shutdown(test_settings):
    analysis_service = MagicMock()
    analysis_service.shutdown = AsyncMock()
    health_monitor = MagicMock()
    health_monitor.start = AsyncMock()
    health_monitor.shutdown = AsyncMock()

    with patch("src.adapters.inbound.grpc.grpc_server.aio.server") as mock_server_factory, patch(
        "src.adapters.inbound.grpc.grpc_server.add_health_check",
        return_value=health_monitor,
    ), patch("src.adapters.inbound.grpc.grpc_server.ai_service_pb2_grpc.add_AIServiceServicer_to_server"):
        server_instance = MagicMock()
        server_instance.start = AsyncMock()
        server_instance.stop = AsyncMock()
        mock_server_factory.return_value = server_instance

        server = GRPCServer(analysis_service)

        async def trigger_stop():
            await asyncio.sleep(0.05)
            server._stop_handler()

        asyncio.create_task(trigger_stop())
        await server.start()

    server_instance.add_insecure_port.assert_called_once_with(f"[::]:{test_settings.GRPC_PORT}")
    health_monitor.start.assert_awaited_once()
    health_monitor.shutdown.assert_awaited_once()
    analysis_service.shutdown.assert_awaited_once()
    server_instance.stop.assert_awaited_once_with(grace=10)


@pytest.mark.asyncio
async def test_add_health_check_returns_monitor():
    analysis_service = MagicMock()
    analysis_service.health_reporters = {}
    server = MagicMock()

    monitor = add_health_check(server, analysis_service)

    assert isinstance(monitor, HealthMonitor)


@pytest.mark.asyncio
async def test_health_monitor_marks_queue_saturation_unhealthy():
    engine = MagicMock()
    engine.health_snapshot.return_value = BatcherHealthSnapshot(
        status=BatcherHealthStatus.QUEUE_FULL,
        queue_size=1,
        queue_capacity=1,
    )
    analysis_service = MagicMock()
    analysis_service.health_reporters = {"spark": engine}
    monitor = HealthMonitor(analysis_service)

    state, reason = monitor._resolve_state()

    # QUEUE_FULL is transient load, should stay SERVING and shed via RESOURCE_EXHAUSTED
    assert state == health_pb2.HealthCheckResponse.SERVING
    assert reason is None


@pytest.mark.asyncio
async def test_health_monitor_marks_worker_failure_unhealthy():
    engine = MagicMock()
    engine.health_snapshot.return_value = BatcherHealthSnapshot(
        status=BatcherHealthStatus.WORKER_UNAVAILABLE,
        queue_size=0,
        queue_capacity=1,
    )
    analysis_service = MagicMock()
    analysis_service.health_reporters = {"spark": engine}
    monitor = HealthMonitor(analysis_service)

    state, reason = monitor._resolve_state()

    assert state == health_pb2.HealthCheckResponse.NOT_SERVING
    assert reason == "batch_worker_stopped"


@pytest.mark.asyncio
async def test_health_monitor_marks_open_circuit_unhealthy():
    engine = MagicMock()
    engine.health_snapshot.return_value = BatcherHealthSnapshot(
        status=BatcherHealthStatus.CIRCUIT_OPEN,
        queue_size=0,
        queue_capacity=8,
        circuit_open_remaining=30,
    )
    analysis_service = MagicMock()
    analysis_service.health_reporters = {"spark": engine}
    monitor = HealthMonitor(analysis_service)

    state, reason = monitor._resolve_state()

    assert state == health_pb2.HealthCheckResponse.NOT_SERVING
    assert reason == "inference_circuit_open"


@pytest.mark.asyncio
async def test_health_monitor_publishes_health_metrics(mocker):
    engine = MagicMock()
    snapshot = BatcherHealthSnapshot(
        status=BatcherHealthStatus.QUEUE_FULL,
        queue_size=8,
        queue_capacity=8,
    )
    engine.health_snapshot.return_value = snapshot
    analysis_service = MagicMock()
    analysis_service.health_reporters = {"spark": engine}
    monitor = HealthMonitor(analysis_service)
    mock_service_health = mocker.patch("src.adapters.inbound.grpc.health.set_service_health")
    mock_engine_health = mocker.patch("src.adapters.inbound.grpc.health.set_engine_health")

    await monitor._publish_state()

    mock_service_health.assert_called_once_with(
        health_pb2.HealthCheckResponse.SERVING,
        None,
    )
    mock_engine_health.assert_called_once_with("spark", snapshot)
