import asyncio
import time
import uuid

import grpc
import jwt
from grpc import aio
import structlog
from src.infrastructure.config import settings
from src.infrastructure.metrics import GRPC_LATENCY_SECONDS, GRPC_REQUESTS_TOTAL, record_auth_failure

logger = structlog.get_logger()

_HEALTH_METHODS = {
    "/grpc.health.v1.Health/Check",
    "/grpc.health.v1.Health/Watch",
}
_ALLOWED_MODELS = {"spark", "flare"}
_MAX_TRACE_ID_LEN = 128
_MAX_SUB_LEN = 128
_MAX_TOKEN_LEN = 8192

def _normalize_metadata(invocation_metadata):
    normalized = {}
    for key, value in (invocation_metadata or []):
        low = key.lower()
        # Keep last value for duplicate keys (gRPC metadata can duplicate)
        normalized[low] = value
    return normalized

def _truncate(value: str, limit: int) -> str:
    if len(value) > limit:
        return value[:limit]
    return value

class AuthInterceptor(aio.ServerInterceptor):
    async def intercept_service(self, continuation, handler_call_details):
        if handler_call_details.method in _HEALTH_METHODS:
            return await continuation(handler_call_details)

        metadata = _normalize_metadata(handler_call_details.invocation_metadata)
        method_name = handler_call_details.method.split("/")[-1]

        # Check API key first (constant time compare not needed here, but keep simple)
        api_key = metadata.get("x-api-key")
        if api_key is not None and api_key == settings.API_KEY:
            structlog.contextvars.bind_contextvars(auth_type="api_key", user_id="internal_service")
            return await continuation(handler_call_details)

        auth_header = metadata.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            # Auth failed — return UNAUTHENTICATED for both known and unknown to hide enumeration
            handler = await continuation(handler_call_details)
            return self._build_unauthenticated_handler(
                handler,
                method_name,
                "missing_or_invalid_token",
                "Invalid or missing Bearer token",
            )

        token = auth_header[7:].strip()
        if len(token) > _MAX_TOKEN_LEN:
            handler = await continuation(handler_call_details)
            return self._build_unauthenticated_handler(
                handler, method_name, "missing_or_invalid_token", "Invalid or missing Bearer token"
            )
        if not token:
            handler = await continuation(handler_call_details)
            return self._build_unauthenticated_handler(
                handler, method_name, "missing_or_invalid_token", "Invalid or missing Bearer token"
            )

        try:
            decoded = jwt.decode(
                token,
                settings.API_KEY,
                algorithms=["HS256"],
                options={"require": ["exp", "sub"]},
            )
            sub = decoded.get("sub")
            if not isinstance(sub, str) or not sub.strip():
                raise jwt.InvalidTokenError("Missing sub")
            # Truncate sub to avoid log injection
            sub = _truncate(sub, _MAX_SUB_LEN)
            structlog.contextvars.bind_contextvars(auth_type="jwt", user_id=sub)
        except jwt.ExpiredSignatureError:
            handler = await continuation(handler_call_details)
            return self._build_unauthenticated_handler(handler, method_name, "token_expired", "Token expired")
        except jwt.InvalidTokenError:
            handler = await continuation(handler_call_details)
            return self._build_unauthenticated_handler(
                handler,
                method_name,
                "missing_or_invalid_token",
                "Invalid or missing Bearer token",
            )

        return await continuation(handler_call_details)

    def _build_unauthenticated_handler(
        self,
        handler,
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

        # If handler is None (unknown method), return generic UNAUTHENTICATED handler (use unary_unary as fallback)
        if handler is None:
            return grpc.unary_unary_rpc_method_handler(unary_unary_abort)

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

        method_name = handler_call_details.method.split("/")[-1]
        start_time = time.monotonic()
        metadata = _normalize_metadata(handler_call_details.invocation_metadata)
        raw_trace = self._resolve_trace_id(metadata)
        trace_id = _truncate(raw_trace, _MAX_TRACE_ID_LEN)
        # Validate charset (alphanumeric + - _ ) — if invalid, generate new
        if not trace_id.replace("-", "").replace("_", "").isalnum():
            trace_id = str(uuid.uuid4())

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
                    try:
                        if hasattr(context, "done") and context.done():
                            break
                    except Exception:
                        pass
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
                    try:
                        if hasattr(context, "done") and context.done():
                            break
                    except Exception:
                        pass
                    yield response
            except BaseException as error:
                response_code = self._resolve_response_code(error)
                raise
            finally:
                self._record_metrics(method_name, model_label, start_time, response_code)

        return stream_stream_wrapper

    def _record_metrics(self, method_name: str, model_label: str, start_time: float, response_code: str) -> None:
        duration = time.monotonic() - start_time
        # Allow-list model label to avoid cardinality explosion
        safe_label = model_label if model_label in _ALLOWED_MODELS else ("spark" if model_label == "spark" else "unknown" if model_label == "unknown" else "invalid")
        # Actually above logic is redundant; implement simple allow-list
        if safe_label not in _ALLOWED_MODELS and safe_label not in ("unknown", "invalid"):
            safe_label = "invalid"
        # Re-resolve correctly
        if model_label in _ALLOWED_MODELS:
            safe_label = model_label
        elif model_label in ("unknown", "invalid"):
            safe_label = model_label
        else:
            safe_label = "invalid"
        GRPC_REQUESTS_TOTAL.labels(method=method_name, code=response_code, model=safe_label).inc()
        GRPC_LATENCY_SECONDS.labels(method=method_name, model=safe_label).observe(duration)
        # Use debug to avoid log flood at 1000 rps
        logger.debug("grpc_request_processed", method=method_name, duration=duration, code=response_code)
        structlog.contextvars.clear_contextvars()

    def _resolve_model_label(self, request) -> str:
        if request is None or not hasattr(request, "model_id"):
            return "unknown"

        raw = getattr(request, "model_id", "")
        if not isinstance(raw, str):
            return "unknown"
        model_id = raw.strip().lower()
        if not model_id:
            return "spark"
        if len(model_id) > 64:
            model_id = model_id[:64]
        if model_id in _ALLOWED_MODELS:
            return model_id
        return "invalid"

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
                return str(value)
        return str(uuid.uuid4())
