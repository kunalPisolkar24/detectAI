"""The x-api-key gate: every RPC is denied before dispatch unless the key
matches, with the two health methods exempt so probes stay open.
"""

import hmac

import grpc
from grpc import aio

_HEALTH_METHODS = frozenset({
    "/grpc.health.v1.Health/Check",
    "/grpc.health.v1.Health/Watch",
})

_API_KEY_METADATA = "x-api-key"
_DENY_DETAIL = "Missing or invalid API key"


class ApiKeyAuthInterceptor(aio.ServerInterceptor):
    def __init__(self, api_key: str) -> None:
        self._api_key = api_key

    async def intercept_service(self, continuation, handler_call_details):
        if handler_call_details.method in _HEALTH_METHODS:
            return await continuation(handler_call_details)

        provided = _metadata_value(handler_call_details.invocation_metadata, _API_KEY_METADATA)
        if isinstance(provided, str) and hmac.compare_digest(provided, self._api_key):
            return await continuation(handler_call_details)

        return _unauthenticated_handler(await continuation(handler_call_details))


def _metadata_value(invocation_metadata, name: str) -> str | bytes | None:
    for key, value in invocation_metadata or ():
        if key.lower() == name:
            return value
    return None


async def _abort_unary(request, context):
    await context.abort(grpc.StatusCode.UNAUTHENTICATED, _DENY_DETAIL)


async def _abort_stream(request, context):
    await context.abort(grpc.StatusCode.UNAUTHENTICATED, _DENY_DETAIL)
    yield  # unreachable: abort raises; the yield only marks this an async generator


def _unauthenticated_handler(handler):
    if handler is None:
        return grpc.unary_unary_rpc_method_handler(_abort_unary)
    if handler.request_streaming and handler.response_streaming:
        return grpc.stream_stream_rpc_method_handler(
            _abort_stream,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )
    if handler.request_streaming:
        return grpc.stream_unary_rpc_method_handler(
            _abort_unary,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )
    if handler.response_streaming:
        return grpc.unary_stream_rpc_method_handler(
            _abort_stream,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )
    return grpc.unary_unary_rpc_method_handler(
        _abort_unary,
        request_deserializer=handler.request_deserializer,
        response_serializer=handler.response_serializer,
    )
