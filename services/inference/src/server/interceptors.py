import jwt
import time
import uuid
import grpc
from grpc import aio
import structlog
from src.config import settings
from src.metrics import GRPC_REQUESTS_TOTAL, GRPC_LATENCY_SECONDS

logger = structlog.get_logger()

class AuthInterceptor(aio.ServerInterceptor):
    async def intercept_service(self, continuation, handler_call_details):
        metadata = dict(handler_call_details.invocation_metadata)
        auth_header = metadata.get('authorization', '')
        
        async def abort(request, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, 'Invalid or missing Bearer token')

        if not auth_header.startswith('Bearer '):
            return grpc.unary_unary_rpc_method_handler(abort)
            
        token = auth_header[7:]
        try:
            decoded = jwt.decode(token, settings.API_KEY, algorithms=["HS256"])
            structlog.contextvars.bind_contextvars(user_id=decoded.get('sub'))
        except jwt.ExpiredSignatureError:
            async def abort_expired(request, context):
                await context.abort(grpc.StatusCode.UNAUTHENTICATED, 'Token expired')
            return grpc.unary_unary_rpc_method_handler(abort_expired)
        except jwt.InvalidTokenError:
            return grpc.unary_unary_rpc_method_handler(abort)
        
        return await continuation(handler_call_details)

_TRACE_HEADERS = ("traceparent", "x-b3-traceid", "x-request-id")

class MonitoringInterceptor(aio.ServerInterceptor):
    async def intercept_service(self, continuation, handler_call_details):
        method_name = handler_call_details.method.split('/')[-1]
        start_time = time.monotonic()
        metadata = dict(handler_call_details.invocation_metadata)
        trace_id = self._resolve_trace_id(metadata)
        
        structlog.contextvars.bind_contextvars(trace_id=trace_id)
        
        model_label = "unknown"
        if "Spark" in method_name:
            model_label = "spark"
        elif "Flare" in method_name:
            model_label = "flare"

        handler = await continuation(handler_call_details)

        # Assuming handler can be unary-unary or unary-stream here
        if handler.stream_unary or handler.stream_stream or handler.unary_stream:
            orig_behavior = handler.behavior
            
            async def streaming_wrapper(request, context):
                response_code = "OK"
                try:
                    async for response in orig_behavior(request, context):
                        yield response
                except Exception as e:
                    response_code = "INTERNAL"
                    if isinstance(e, grpc.RpcError):
                        response_code = str(e.code())
                    raise e
                finally:
                    duration = time.monotonic() - start_time
                    GRPC_REQUESTS_TOTAL.labels(method=method_name, code=response_code, model=model_label).inc()
                    GRPC_LATENCY_SECONDS.labels(method=method_name, model=model_label).observe(duration)
                    logger.info("grpc_request_processed", method=method_name, duration=duration, code=response_code)
                    structlog.contextvars.clear_contextvars()
                    
            if handler.unary_stream:
                return grpc.unary_stream_rpc_method_handler(
                    streaming_wrapper,
                    request_deserializer=handler.request_deserializer,
                    response_serializer=handler.response_serializer
                )
            else:
                return handler

        else:
            orig_behavior = handler.behavior

            async def unary_wrapper(request, context):
                response_code = "OK"
                try:
                    return await orig_behavior(request, context)
                except Exception as e:
                    response_code = "INTERNAL"
                    if isinstance(e, grpc.RpcError):
                        response_code = str(e.code())
                    raise e
                finally:
                    duration = time.monotonic() - start_time
                    GRPC_REQUESTS_TOTAL.labels(method=method_name, code=response_code, model=model_label).inc()
                    GRPC_LATENCY_SECONDS.labels(method=method_name, model=model_label).observe(duration)
                    logger.info("grpc_request_processed", method=method_name, duration=duration, code=response_code)
                    structlog.contextvars.clear_contextvars()

            return grpc.unary_unary_rpc_method_handler(
                unary_wrapper,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer
            )


    def _resolve_trace_id(self, metadata: dict) -> str:
        for header in _TRACE_HEADERS:
            value = metadata.get(header)
            if value:
                return value
        return str(uuid.uuid4())