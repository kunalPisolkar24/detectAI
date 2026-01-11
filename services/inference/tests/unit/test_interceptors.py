import pytest
import grpc
from src.server.interceptors import AuthInterceptor, MonitoringInterceptor

class MockHandlerDetails:
    def __init__(self, metadata, method):
        self.invocation_metadata = metadata
        self.method = method

def test_auth_interceptor_valid(mock_settings):
    interceptor = AuthInterceptor()
    continuation = lambda x: "Success"
    details = MockHandlerDetails([('x-api-key', 'test-secret-key')], '/service/method')
    
    result = interceptor.intercept_service(continuation, details)
    assert result == "Success"

def test_auth_interceptor_invalid(mock_settings):
    interceptor = AuthInterceptor()
    continuation = lambda x: "Success"
    details = MockHandlerDetails([('x-api-key', 'wrong-key')], '/service/method')
    
    handler = interceptor.intercept_service(continuation, details)
    
    mock_context = type('MockContext', (), {'abort': lambda c, d: None})()
    mock_abort = pytest.MonkeyPatch()
    
    aborted = False
    def abort(code, details):
        nonlocal aborted
        if code == grpc.StatusCode.UNAUTHENTICATED:
            aborted = True
            
    mock_context.abort = abort
    handler.unary_unary(None, mock_context)
    assert aborted

def test_monitoring_interceptor_metrics(mocker):
    interceptor = MonitoringInterceptor()
    continuation = lambda x: "Response"
    details = MockHandlerDetails([], '/aidetection.AIService/DetectSpark')
    
    mock_counter = mocker.patch('src.server.interceptors.GRPC_REQUESTS_TOTAL')
    mock_latency = mocker.patch('src.server.interceptors.GRPC_LATENCY_SECONDS')
    
    result = interceptor.intercept_service(continuation, details)
    
    assert result == "Response"
    mock_counter.labels.assert_called_with(
        method='DetectSpark', 
        code='OK', 
        model='spark'
    )
    mock_latency.labels.assert_called_with(
        method='DetectSpark', 
        model='spark'
    )

def test_monitoring_interceptor_exception(mocker):
    interceptor = MonitoringInterceptor()
    def continuation(x): raise RuntimeError("Fail")
    details = MockHandlerDetails([], '/aidetection.AIService/DetectFlare')
    
    mock_counter = mocker.patch('src.server.interceptors.GRPC_REQUESTS_TOTAL')
    
    with pytest.raises(RuntimeError):
        interceptor.intercept_service(continuation, details)
        
    mock_counter.labels.assert_called_with(
        method='DetectFlare', 
        code='INTERNAL', 
        model='flare'
    )