import asyncio
import time
import uuid

import grpc
import jwt
from grpc import aio
import structlog
from src.config import settings
from src.metrics import GRPC_LATENCY_SECONDS, GRPC_REQUESTS_TOTAL, record_auth_failure

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
        method_name = handler_call_details.method.split('/')[-1]

        if not auth_header.startswith("Bearer "):
            return self._build_unauthenticated_handler(
                handler,
                method_name,
                "missing_or_invalid_token",
                "Invalid or missing Bearer token",
            )

        token = auth_header[7:]
        try:
            decoded = jwt.decode(token, settings.API_KEY, algorithms=["HS256"])
            structlog.contextvars.bind_contextvars(user_id=decoded.get("sub"))
        except jwt.ExpiredSignatureError:
            return self._build_unauthenticated_handler(handler, method_name, "token_expired", "Token expired")
        except jwt.InvalidTokenError:
            return self._build_unauthenticated_handler(
                handler,
                method_name,
                "missing_or_invalid_token",
                "Invalid or missing Bearer token",
            )

        return handler

    def _build_unauthenticated_handler(
        self,
        handler: grpc.RpcMethodHandler,
        method_name: str,
        failure_reason: str,
        detail: str,
    ):
        async def unary_unary_abort(request, context):
            record_auth_failure(method_name, failure_reason)
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)

        async def unary_stream_abort(request, context):
            record_auth_failure(method_name, failure_reason)
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)
            if False:
                yield None

        async def stream_unary_abort(request_iterator, context):
            record_auth_failure(method_name, failure_reason)
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)

        async def stream_stream_abort(request_iterator, context):
            record_auth_failure(method_name, failure_reason)
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
        if handler_call_details.method in _HEALTH_METHODS:
            return await continuation(handler_call_details)

        method_name = handler_call_details.method.split('/')[-1]
        start_time = time.monotonic()
        metadata = dict(handler_call_details.invocation_metadata)
        trace_id = self._resolve_trace_id(metadata)
        
        structlog.contextvars.bind_contextvars(trace_id=trace_id)

        handler = await continuation(handler_call_details)
        if handler is None:
            structlog.contextvars.clear_contextvars()
            return None

        if handler.unary_unary:
            return grpc.unary_unary_rpc_method_handler(
                self._wrap_unary(handler.unary_unary, method_name, start_time),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        if handler.unary_stream:
            return grpc.unary_stream_rpc_method_handler(
                self._wrap_unary_stream(handler.unary_stream, method_name, start_time),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        if handler.stream_unary:
            return grpc.stream_unary_rpc_method_handler(
                self._wrap_stream_unary(handler.stream_unary, method_name, "unknown", start_time),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        if handler.stream_stream:
            return grpc.stream_stream_rpc_method_handler(
                self._wrap_stream_stream(handler.stream_stream, method_name, "unknown", start_time),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )

        structlog.contextvars.clear_contextvars()
        return handler

    def _wrap_unary(self, behavior, method_name: str, start_time: float):
        async def unary_wrapper(request, context):
            response_code = "OK"
            model_label = self._resolve_model_label(request)
            try:
                return await behavior(request, context)
            except BaseException as error:
                response_code = self._resolve_response_code(error)
                raise
            finally:
                self._record_metrics(method_name, model_label, start_time, response_code)

        return unary_wrapper

    def _wrap_unary_stream(self, behavior, method_name: str, start_time: float):
        async def unary_stream_wrapper(request, context):
            response_code = "OK"
            model_label = self._resolve_model_label(request)
            try:
                async for response in behavior(request, context):
                    yield response
            except BaseException as error:
                response_code = self._resolve_response_code(error)
                raise
            finally:
                self._record_metrics(method_name, model_label, start_time, response_code)

        return unary_stream_wrapper

    def _wrap_stream_unary(self, behavior, method_name: str, model_label: str, start_time: float):
        async def stream_unary_wrapper(request_iterator, context):
            response_code = "OK"
            try:
                return await behavior(request_iterator, context)
            except BaseException as error:
                response_code = self._resolve_response_code(error)
                raise
            finally:
                self._record_metrics(method_name, model_label, start_time, response_code)

        return stream_unary_wrapper

    def _wrap_stream_stream(self, behavior, method_name: str, model_label: str, start_time: float):
        async def stream_stream_wrapper(request_iterator, context):
            response_code = "OK"
            try:
                async for response in behavior(request_iterator, context):
                    yield response
            except BaseException as error:
                response_code = self._resolve_response_code(error)
                raise
            finally:
                self._record_metrics(method_name, model_label, start_time, response_code)

        return stream_stream_wrapper

    def _record_metrics(self, method_name: str, model_label: str, start_time: float, response_code: str) -> None:
        duration = time.monotonic() - start_time
        GRPC_REQUESTS_TOTAL.labels(method=method_name, code=response_code, model=model_label).inc()
        GRPC_LATENCY_SECONDS.labels(method=method_name, model=model_label).observe(duration)
        logger.info("grpc_request_processed", method=method_name, duration=duration, code=response_code)
        structlog.contextvars.clear_contextvars()

    def _resolve_model_label(self, request) -> str:
        if request is None or not hasattr(request, "model_id"):
            return "unknown"

        model_id = request.model_id.strip().lower()
        if model_id:
            return model_id
        return "spark"

    def _resolve_response_code(self, error: BaseException) -> str:
        if isinstance(error, asyncio.CancelledError):
            return grpc.StatusCode.CANCELLED.name
        if isinstance(error, grpc.RpcError):
            code = error.code()
            if code is not None:
                return code.name
            return grpc.StatusCode.UNKNOWN.name
        return grpc.StatusCode.INTERNAL.name

    def _resolve_trace_id(self, metadata: dict) -> str:
        for header in _TRACE_HEADERS:
            value = metadata.get(header)
            if value:
                return value
        return str(uuid.uuid4())
