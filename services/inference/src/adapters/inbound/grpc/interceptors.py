import asyncio
import time
import uuid

import grpc
import jwt
from grpc import aio
import structlog

from src.infrastructure.metrics import GRPC_LATENCY_SECONDS, GRPC_REQUESTS_TOTAL, record_auth_failure

logger = structlog.get_logger()

_HEALTH_METHODS = {"/grpc.health.v1.Health/Check", "/grpc.health.v1.Health/Watch"}
_ALLOWED_MODELS = {"spark", "flare"}
_MAX_TRACE_ID_LEN = 128
_MAX_SUB_LEN = 128
_MAX_TOKEN_LEN = 8192
_TRACE_HEADERS = ("traceparent", "x-b3-traceid", "x-request-id")


def _normalize_metadata(invocation_metadata):
    normalized = {}
    for k, v in (invocation_metadata or []):
        normalized[k.lower()] = v
    return normalized


def _truncate(value: str, limit: int) -> str:
    return value[:limit] if len(value) > limit else value


class AuthInterceptor(aio.ServerInterceptor):
    def __init__(self, settings, telemetry=None) -> None:
        if settings is None:
            raise ValueError("AuthInterceptor requires explicit settings (DI) — global settings removed")
        self._settings = settings
        self.telemetry = telemetry

    @property
    def settings(self):
        return self._settings

    async def intercept_service(self, continuation, handler_call_details):
        if handler_call_details.method in _HEALTH_METHODS:
            return await continuation(handler_call_details)

        metadata = _normalize_metadata(handler_call_details.invocation_metadata)
        method = handler_call_details.method.split("/")[-1]

        api_key = metadata.get("x-api-key")
        if api_key is not None and api_key == self.settings.API_KEY:
            structlog.contextvars.bind_contextvars(auth_type="api_key", user_id="internal_service")
            return await continuation(handler_call_details)

        auth_header = metadata.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return await self._deny(continuation, handler_call_details, method, "missing_or_invalid_token", "Invalid or missing Bearer token")

        token = auth_header[7:].strip()
        if not token or len(token) > _MAX_TOKEN_LEN:
            return await self._deny(continuation, handler_call_details, method, "missing_or_invalid_token", "Invalid or missing Bearer token")

        try:
            decoded = jwt.decode(token, self.settings.API_KEY, algorithms=["HS256"], options={"require": ["exp", "sub"]})
            sub = decoded.get("sub")
            if not isinstance(sub, str) or not sub.strip():
                raise jwt.InvalidTokenError("Missing sub")
            structlog.contextvars.bind_contextvars(auth_type="jwt", user_id=_truncate(sub, _MAX_SUB_LEN))
        except jwt.ExpiredSignatureError:
            return await self._deny(continuation, handler_call_details, method, "token_expired", "Token expired")
        except jwt.InvalidTokenError:
            return await self._deny(continuation, handler_call_details, method, "missing_or_invalid_token", "Invalid or missing Bearer token")

        return await continuation(handler_call_details)

    async def _deny(self, continuation, details, method, reason, detail):
        handler = await continuation(details)
        return self._build_unauthenticated_handler(handler, method, reason, detail)

    def _build_unauthenticated_handler(self, handler, method_name: str, failure_reason: str, detail: str):
        def _record():
            if self.telemetry is not None:
                try:
                    self.telemetry.record_auth_failure(method_name, failure_reason)
                    return
                except Exception:
                    pass
            try:
                record_auth_failure(method_name, failure_reason)
            except Exception:
                pass

        async def _abort(request, context):
            _record()
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)

        async def _abort_stream(request, context):
            _record()
            await context.abort(grpc.StatusCode.UNAUTHENTICATED, detail)
            if False:
                yield None

        if handler is None:
            return grpc.unary_unary_rpc_method_handler(_abort)

        if handler.request_streaming and handler.response_streaming:
            return grpc.stream_stream_rpc_method_handler(_abort_stream, request_deserializer=handler.request_deserializer, response_serializer=handler.response_serializer)
        if handler.request_streaming:
            return grpc.stream_unary_rpc_method_handler(_abort, request_deserializer=handler.request_deserializer, response_serializer=handler.response_serializer)
        if handler.response_streaming:
            return grpc.unary_stream_rpc_method_handler(_abort_stream, request_deserializer=handler.request_deserializer, response_serializer=handler.response_serializer)
        return grpc.unary_unary_rpc_method_handler(_abort, request_deserializer=handler.request_deserializer, response_serializer=handler.response_serializer)


class MonitoringInterceptor(aio.ServerInterceptor):
    def __init__(self, telemetry=None) -> None:
        self.telemetry = telemetry

    async def intercept_service(self, continuation, handler_call_details):
        if handler_call_details.method in _HEALTH_METHODS:
            return await continuation(handler_call_details)

        method = handler_call_details.method.split("/")[-1]
        start = time.monotonic()
        metadata = _normalize_metadata(handler_call_details.invocation_metadata)
        trace_id = _truncate(self._resolve_trace_id(metadata), _MAX_TRACE_ID_LEN)
        if not trace_id.replace("-", "").replace("_", "").isalnum():
            trace_id = str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(trace_id=trace_id)

        handler = await continuation(handler_call_details)
        if handler is None:
            structlog.contextvars.clear_contextvars()
            return None

        if handler.unary_unary:
            return grpc.unary_unary_rpc_method_handler(
                self._wrap(handler.unary_unary, method, start, streaming=False),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )
        if handler.unary_stream:
            return grpc.unary_stream_rpc_method_handler(
                self._wrap(handler.unary_stream, method, start, streaming=True),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )
        if handler.stream_unary:
            return grpc.stream_unary_rpc_method_handler(
                self._wrap(handler.stream_unary, method, start, streaming=False, stream_request=True),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )
        if handler.stream_stream:
            return grpc.stream_stream_rpc_method_handler(
                self._wrap(handler.stream_stream, method, start, streaming=True, stream_request=True),
                request_deserializer=handler.request_deserializer,
                response_serializer=handler.response_serializer,
            )
        structlog.contextvars.clear_contextvars()
        return handler

    def _wrap(self, behavior, method: str, start: float, streaming: bool, stream_request: bool = False):
        if streaming:
            async def streamed_wrapper(request, context):
                code = "OK"
                label = self._resolve_model_label(request) if not stream_request else "unknown"
                try:
                    async for resp in behavior(request, context):
                        try:
                            if hasattr(context, "done") and context.done():
                                break
                        except Exception:
                            pass
                        yield resp
                except BaseException as e:
                    code = self._resolve_response_code(e)
                    raise
                finally:
                    self._record(method, label, start, code)

            return streamed_wrapper

        async def unary_wrapper(request, context):
            code = "OK"
            label = self._resolve_model_label(request) if not stream_request else "unknown"
            try:
                return await behavior(request, context)
            except BaseException as e:
                code = self._resolve_response_code(e)
                raise
            finally:
                self._record(method, label, start, code)

        return unary_wrapper

    def _record(self, method: str, model_label: str, start: float, code: str) -> None:
        duration = time.monotonic() - start
        safe = model_label if model_label in _ALLOWED_MODELS | {"unknown", "invalid"} else "invalid"
        if self.telemetry is not None:
            try:
                self.telemetry.observe_grpc_request(method, code, safe, duration)
            except Exception:
                pass
        try:
            GRPC_REQUESTS_TOTAL.labels(method=method, code=code, model=safe).inc()
            GRPC_LATENCY_SECONDS.labels(method=method, model=safe).observe(duration)
        except Exception:
            pass
        logger.debug("grpc_request_processed", method=method, duration=duration, code=code)
        structlog.contextvars.clear_contextvars()

    def _resolve_model_label(self, request) -> str:
        if request is None or not hasattr(request, "model_id"):
            return "unknown"
        raw = getattr(request, "model_id", "")
        if not isinstance(raw, str):
            return "unknown"
        mid = raw.strip().lower()
        if not mid:
            return "spark"
        if len(mid) > 64:
            mid = mid[:64]
        return mid if mid in _ALLOWED_MODELS else "invalid"

    def _resolve_response_code(self, error: BaseException) -> str:
        if isinstance(error, asyncio.CancelledError):
            return grpc.StatusCode.CANCELLED.name
        if isinstance(error, grpc.RpcError):
            c = error.code()
            return c.name if c is not None else grpc.StatusCode.UNKNOWN.name
        return grpc.StatusCode.INTERNAL.name

    def _resolve_trace_id(self, metadata: dict) -> str:
        try:
            from opentelemetry import trace as otel_trace

            span = otel_trace.get_current_span()
            ctx = span.get_span_context()
            if ctx is not None and getattr(ctx, "is_valid", False):
                tid = format(ctx.trace_id, "032x")
                if tid and tid != "0" * 32:
                    return tid
        except Exception:
            pass
        for h in _TRACE_HEADERS:
            v = metadata.get(h)
            if v:
                return str(v)
        return str(uuid.uuid4())



