import time
import uuid
import grpc
import structlog
from src.config import settings
from src.metrics import GRPC_REQUESTS_TOTAL, GRPC_LATENCY_SECONDS

logger = structlog.get_logger()

class AuthInterceptor(grpc.ServerInterceptor):
    def intercept_service(self, continuation, handler_call_details):
        metadata = dict(handler_call_details.invocation_metadata)
        if metadata.get('x-api-key') != settings.API_KEY:
            def abort(ignored_request, context):
                context.abort(grpc.StatusCode.UNAUTHENTICATED, 'Invalid API Key')
                return None
            return grpc.unary_unary_rpc_method_handler(abort)
        
        return continuation(handler_call_details)

class MonitoringInterceptor(grpc.ServerInterceptor):
    def intercept_service(self, continuation, handler_call_details):
        method_name = handler_call_details.method.split('/')[-1]
        start_time = time.monotonic()
        trace_id = str(uuid.uuid4())
        
        structlog.contextvars.bind_contextvars(trace_id=trace_id)
        
        model_label = "unknown"
        if "Spark" in method_name:
            model_label = "spark"
        elif "Flare" in method_name:
            model_label = "flare"

        response_code = "OK"
        try:
            return continuation(handler_call_details)
        except Exception as e:
            response_code = "INTERNAL"
            if isinstance(e, grpc.RpcError):
                response_code = str(e.code())
            raise e
        finally:
            duration = time.monotonic() - start_time
            
            GRPC_REQUESTS_TOTAL.labels(
                method=method_name, 
                code=response_code, 
                model=model_label
            ).inc()
            
            GRPC_LATENCY_SECONDS.labels(
                method=method_name, 
                model=model_label
            ).observe(duration)

            logger.info("grpc_request_processed",
                       method=method_name,
                       duration=duration,
                       code=response_code)
            
            structlog.contextvars.clear_contextvars()