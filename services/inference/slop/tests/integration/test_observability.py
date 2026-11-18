import pytest
import grpc
from prometheus_client import REGISTRY
from src.generated import ai_service_pb2, ai_service_pb2_grpc

@pytest.mark.asyncio
async def test_metrics_are_recorded(integration_app, auth_token):
    port = integration_app["port"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)
    
    metadata = (("authorization", f"Bearer {auth_token}"),)
    
    # Send a request to trigger metrics
    request = ai_service_pb2.PredictRequest(text="test observation", model_id="spark")
    await stub.Detect(request, metadata=metadata)
    
    # Check if grpc_requests_total was incremented
    # Counter name: grpc_requests_total_total (Prometheus adds _total for Counters)
    # But get_sample_value usually expects the raw name
    
    val = REGISTRY.get_sample_value('grpc_requests_total', labels={'method': 'Detect', 'code': 'OK', 'model': 'spark'})
    assert val is not None
    assert val >= 1
    
    await channel.close()

@pytest.mark.asyncio
async def test_health_check_status(integration_app):
    port = integration_app["port"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    from grpc_health.v1 import health_pb2, health_pb2_grpc
    
    stub = health_pb2_grpc.HealthStub(channel)
    
    # Initial status should be SERVING because integration_app fixture waits for it
    response = await stub.Check(health_pb2.HealthCheckRequest(service=""))
    assert response.status == health_pb2.HealthCheckResponse.SERVING
    
    # Verify metrics for health
    val = REGISTRY.get_sample_value('inference_service_health_status', labels={'status': 'serving'})
    assert val == 1
    
    await channel.close()
