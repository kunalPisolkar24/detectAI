import jwt
import time
import uuid
import grpc
from grpc import aio
import structlog
from src.config import settings
from src.metrics import GRPC_REQUESTS_TOTAL, GRPC_LATENCY_SECONDS

logger = structlog.get_logger()

_HEALTH_METHODS = {
    "/grpc.health.v1.Health/Check",
    "/grpc.health.v1.Health/Watch",
}


class AuthInterceptor(aio.ServerInterceptor):
    async def intercept_service(self, continuation, handler_call_details):
        if handler_call_details.method in _HEALTH_METHODS:
            return await continuation(handler_call_details)

        handler = await continuation(handler_call_details)
        if handler is None:
            return None

        metadata = dict(handler_call_details.invocation_metadata)
        auth_header = metadata.get("authorization", "")

        if not auth_header.startswith("Bearer "):
            return self._build_unauthenticated_handler(handler, "Invalid or missing Bearer token")

        token = auth_header[7:]
        try:
            decoded = jwt.decode(token, settings.API_KEY, algorithms=["HS256"])
            structlog.contextvars.bind_contextvars(user_id=decoded.get("sub"))
        except jwt.ExpiredSignatureError:
            return self._build_unauthenticated_handler(handler, "Token expired")
        except jwt.InvalidTokenError:
            return self._build_unauthenticated_handler(handler, "Invalid or missing Bearer token")

        return handler

    def _build_unauthenticated_handler(self, handler: grpc.RpcMethodHandler, detail: str):
        async def unary_unary_abort(request, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)

        async def unary_stream_abort(request, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)
            if False:
                yield None

        async def stream_unary_abort(request_iterator, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)

        async def stream_stream_abort(request_iterator, context):
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)
            if False:
                yield None

        if handler.request_streaming and handler.response_streaming:
            return grpc.stream_stream_rpc_method_handler(
                stream_stream_abort,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        if handler.request_streaming:
            return grpc.stream_unary_rpc_method_handler(
                stream_unary_abort,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        if handler.response_streaming:
            return grpc.unary_stream_rpc_method_handler(
                unary_stream_abort,
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        return grpc.unary_unary_rpc_method_handler(
            unary_unary_abort,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )

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
