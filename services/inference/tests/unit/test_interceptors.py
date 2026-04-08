import grpc
import pytest

from src.server.interceptors import AuthInterceptor, MonitoringInterceptor


class MockHandlerDetails:
    def __init__(self, metadata, method):
        self.invocation_metadata = metadata
        self.method = method


@pytest.mark.asyncio
async def test_auth_interceptor_bypasses_health_rpc(test_settings):
    interceptor = AuthInterceptor()
    handler = grpc.unary_unary_rpc_method_handler(lambda request, context: None)

    async def continuation(details):
        return handler

    details = MockHandlerDetails([], "/grpc.health.v1.Health/Check")

    result = await interceptor.intercept_service(continuation, details)

    assert result is handler


@pytest.mark.asyncio
async def test_auth_interceptor_rejects_missing_token_for_streaming_rpc(test_settings, grpc_context):
    interceptor = AuthInterceptor()

    async def behavior(request, context):
        if False:
            yield request

    async def continuation(details):
        return grpc.unary_stream_rpc_method_handler(behavior)

    details = MockHandlerDetails([], "/aidetection.AIService/AnalyzeDocument")
    handler = await interceptor.intercept_service(continuation, details)

    assert handler.response_streaming is True
    assert handler.request_streaming is False

    with pytest.raises(Exception, match="Invalid or missing Bearer token"):
        async for _ in handler.unary_stream(None, grpc_context):
            pass

    assert grpc_context.aborts == [
        (grpc.StatusCode.UNAUTHENTICATED, "Invalid or missing Bearer token")
    ]


@pytest.mark.asyncio
async def test_auth_interceptor_rejects_expired_token(test_settings, expired_auth_token, grpc_context):
    interceptor = AuthInterceptor()

    async def continuation(details):
        return grpc.unary_unary_rpc_method_handler(lambda request, context: None)

    details = MockHandlerDetails(
        [("authorization", f"Bearer {expired_auth_token}")],
        "/aidetection.AIService/Detect",
    )
    handler = await interceptor.intercept_service(continuation, details)

    with pytest.raises(Exception, match="Token expired"):
        await handler.unary_unary(None, grpc_context)

    assert grpc_context.aborts == [
        (grpc.StatusCode.UNAUTHENTICATED, "Token expired")
    ]


@pytest.mark.asyncio
async def test_monitoring_interceptor_records_unary_metrics(mocker):
    interceptor = MonitoringInterceptor()
    mock_counter = mocker.patch("src.server.interceptors.GRPC_REQUESTS_TOTAL")
    mock_latency = mocker.patch("src.server.interceptors.GRPC_LATENCY_SECONDS")

    async def behavior(request, context):
        return "ok"

    async def continuation(details):
        return grpc.unary_unary_rpc_method_handler(behavior)

    details = MockHandlerDetails([], "/aidetection.AIService/Detect")
    handler = await interceptor.intercept_service(continuation, details)
    result = await handler.unary_unary(None, object())

    assert result == "ok"
    mock_counter.labels.return_value.inc.assert_called_once()
    mock_latency.labels.return_value.observe.assert_called_once()
    mock_counter.labels.assert_called_once_with(
        method="Detect",
        code="OK",
        model="unknown",
    )


@pytest.mark.asyncio
async def test_monitoring_interceptor_records_streaming_failures(mocker):
    interceptor = MonitoringInterceptor()
    mock_counter = mocker.patch("src.server.interceptors.GRPC_REQUESTS_TOTAL")

    async def behavior(request, context):
        raise RuntimeError("Fail")
        if False:
            yield request

    async def continuation(details):
        return grpc.unary_stream_rpc_method_handler(behavior)

    details = MockHandlerDetails([], "/aidetection.AIService/AnalyzeDocument")
    handler = await interceptor.intercept_service(continuation, details)

    with pytest.raises(RuntimeError, match="Fail"):
        async for _ in handler.unary_stream(None, object()):
            pass

    mock_counter.labels.assert_called_once_with(
        method="AnalyzeDocument",
        code="INTERNAL",
        model="unknown",
    )
