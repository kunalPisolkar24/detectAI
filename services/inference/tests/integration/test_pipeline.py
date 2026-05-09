import pytest
import grpc
from src.generated import ai_service_pb2, ai_service_pb2_grpc

@pytest.mark.asyncio
async def test_analyze_document_full_pipeline(integration_app, auth_token):
    port = integration_app["port"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    text = "This is a test document that should be long enough to generate multiple chunks. " * 10
    request = ai_service_pb2.AnalyzeDocumentRequest(
        text=text,
        model_id="spark"
    )
    metadata = (("authorization", f"Bearer {auth_token}"),)

    responses = []
    async for response in stub.AnalyzeDocument(request, metadata=metadata):
        responses.append(response)

    assert len(responses) >= 3
    assert responses[0].HasField("started")
    assert responses[-1].HasField("final")
    
    # Verify events
    has_progress = False
    for r in responses:
        if r.HasField("progress"):
            has_progress = True
            assert r.progress.total_chunks > 0
    
    assert has_progress
    assert responses[-1].final.ai_confidence == 50.0
    
    await channel.close()

@pytest.mark.asyncio
async def test_auth_rejection(integration_app):
    port = integration_app["port"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    request = ai_service_pb2.PredictRequest(text="test", model_id="spark")
    
    # Missing token
    with pytest.raises(grpc.aio.AioRpcError) as exc:
        await stub.Detect(request)
    assert exc.value.code() == grpc.StatusCode.UNAUTHENTICATED

    # Invalid token
    with pytest.raises(grpc.aio.AioRpcError) as exc:
        await stub.Detect(request, metadata=(("authorization", "Bearer invalid-token"),))
    assert exc.value.code() == grpc.StatusCode.UNAUTHENTICATED

    await channel.close()

@pytest.mark.asyncio
async def test_invalid_model_id(integration_app, auth_token):
    port = integration_app["port"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)

    request = ai_service_pb2.PredictRequest(text="test", model_id="unknown_model")
    metadata = (("authorization", f"Bearer {auth_token}"),)

    with pytest.raises(grpc.aio.AioRpcError) as exc:
        await stub.Detect(request, metadata=metadata)
    
    # Depending on implementation, might be INVALID_ARGUMENT or INTERNAL
    assert exc.value.code() in (grpc.StatusCode.INVALID_ARGUMENT, grpc.StatusCode.INTERNAL, grpc.StatusCode.UNKNOWN)

    await channel.close()
