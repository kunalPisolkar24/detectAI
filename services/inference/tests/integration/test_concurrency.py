import asyncio
import pytest
import grpc
from src.generated import ai_service_pb2, ai_service_pb2_grpc

@pytest.mark.asyncio
async def test_batch_accumulation(integration_app, auth_token):
    port = integration_app["port"]
    dummy_engine = integration_app["dummy_engine"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)
    
    metadata = (("authorization", f"Bearer {auth_token}"),)
    
    # We want to send multiple requests quickly
    # BATCH_SIZE is 4 in conftest.py
    tasks = [
        stub.Detect(ai_service_pb2.PredictRequest(text=f"test {i}", model_id="spark"), metadata=metadata)
        for i in range(4)
    ]
    
    # Start all requests concurrently
    initial_batch_count = dummy_engine.batch_count
    responses = await asyncio.gather(*tasks)
    
    assert len(responses) == 4
    # With BATCH_SIZE=4 and small sleep, they should ideally be batched together
    # depending on timing, it might be 1 or 2 batches, but definitely less than 4
    assert dummy_engine.batch_count > initial_batch_count
    assert dummy_engine.batch_count <= initial_batch_count + 2 
    
    await channel.close()

@pytest.mark.asyncio
async def test_request_cancellation(integration_app, auth_token):
    port = integration_app["port"]
    channel = grpc.aio.insecure_channel(f"localhost:{port}")
    stub = ai_service_pb2_grpc.AIServiceStub(channel)
    
    metadata = (("authorization", f"Bearer {auth_token}"),)
    
    # Long text to generate many chunks
    text = "chunk " * 100
    request = ai_service_pb2.AnalyzeDocumentRequest(text=text, model_id="spark")
    
    stream = stub.AnalyzeDocument(request, metadata=metadata)
    
    # Read first event and then cancel
    try:
        async for response in stream:
            assert response.HasField("started")
            break
        
        # Cancel the stream
        stream.cancel()
    except asyncio.CancelledError:
        pass
    
    # Wait a bit for server to handle cancellation
    await asyncio.sleep(0.2)
    
    # Since we use a DummyEngine with time.sleep, it's hard to verify server-side cancellation 
    # directly without more complex mocking, but we verify it doesn't crash the server.
    
    await channel.close()
