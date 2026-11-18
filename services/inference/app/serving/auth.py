"""The x-api-key gate: every RPC is denied before dispatch unless the key
matches, with the open methods exempt so probes and the schema stay reachable.
"""

import hmac

import grpc
from grpc import aio

from ..observability import NullObservability
from ..observability.contract import Observability

HEALTH_METHODS = frozenset({
    "/grpc.health.v1.Health/Check",
    "/grpc.health.v1.Health/Watch",
})

_API_KEY_METADATA = "x-api-key"
_DENY_DETAIL = "Missing or invalid API key"


class ApiKeyAuthInterceptor(aio.ServerInterceptor):
    def __init__(
        self,
        api_key: str,
        open_methods: frozenset[str] = HEALTH_METHODS,
        observability: Observability | None = None,
    ) -> None:
        self._api_key = api_key
        self._open_methods = open_methods
        self._observability = observability or NullObservability()

    async def intercept_service(self, continuation, handler_call_details):
        if handler_call_details.method in self._open_methods:
            return await continuation(handler_call_details)

        provided = _metadata_value(handler_call_details.invocation_metadata, _API_KEY_METADATA)
        if isinstance(provided, str) and hmac.compare_digest(provided, self._api_key):
            return await continuation(handler_call_details)

        return _unauthenticated_handler(
            await continuation(handler_call_details), self._observability
        )


def _metadata_value(invocation_metadata, name: str) -> str | bytes | None:
    for key, value in invocation_metadata or ():
        if key.lower() == name:
            return value
    return None


def _abort_handlers(observability: Observability):
    """The denial handlers: they mark the call failed and answer UNAUTHENTICATED."""

    async def _abort_unary(request, context):
        # The call failed: the board's error share counts it.
        observability.mark_failed(grpc.StatusCode.UNAUTHENTICATED.name)
        await context.abort(grpc.StatusCode.UNAUTHENTICATED, _DENY_DETAIL)

    async def _abort_stream(request, context):
        observability.mark_failed(grpc.StatusCode.UNAUTHENTICATED.name)
        await context.abort(grpc.StatusCode.UNAUTHENTICATED, _DENY_DETAIL)
        yield  # unreachable: abort raises; the yield only marks this an async generator

    return _abort_unary, _abort_stream


def _unauthenticated_handler(handler, observability: Observability):
    abort_unary, abort_stream = _abort_handlers(observability)
    if handler is None:
        return grpc.unary_unary_rpc_method_handler(abort_unary)
    if handler.request_streaming and handler.response_streaming:
        return grpc.stream_stream_rpc_method_handler(
            abort_stream,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )
    if handler.request_streaming:
        return grpc.stream_unary_rpc_method_handler(
            abort_unary,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )
    if handler.response_streaming:
        return grpc.unary_stream_rpc_method_handler(
            abort_stream,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )
    return grpc.unary_unary_rpc_method_handler(
        abort_unary,
        request_deserializer=handler.request_deserializer,
        response_serializer=handler.response_serializer,
    )
