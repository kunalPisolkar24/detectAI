"""The x-api-key gate: health passes open, a matching key passes through, and
everything else lands on an UNAUTHENTICATED abort in the handler's own shape.
"""

import asyncio

import grpc
import pytest

from app.serving.auth import ApiKeyAuthInterceptor

_API_KEY = "unit-test-key-16chars"
_HEALTH_CHECK = "/grpc.health.v1.Health/Check"
_HEALTH_WATCH = "/grpc.health.v1.Health/Watch"
_DETECT = "/inference.v1.AIService/Detect"


class _AbortRecorded(Exception):
    """Stands in for aio's abort signal: a denied behavior must stop here."""


class _RecordingContext:
    def __init__(self) -> None:
        self.code = None
        self.details = None

    async def abort(self, code, details=None):
        self.code = code
        self.details = details
        raise _AbortRecorded


def _unary_handler() -> grpc.RpcMethodHandler:
    async def behavior(request, context):
        return None

    return grpc.unary_unary_rpc_method_handler(behavior)


def _streaming_handler() -> grpc.RpcMethodHandler:
    async def behavior(request, context):
        yield None

    return grpc.unary_stream_rpc_method_handler(behavior)


def _details(method: str, metadata=()) -> grpc.HandlerCallDetails:
    """grpcio exposes HandlerCallDetails as an attribute bag, not a constructor."""

    class CallDetails(grpc.HandlerCallDetails):
        pass

    details = CallDetails()
    details.method = method
    details.invocation_metadata = metadata
    return details


def _intercept(method: str, metadata=(), handler=None):
    sentinel = _unary_handler() if handler is None else handler
    return asyncio.run(
        ApiKeyAuthInterceptor(_API_KEY).intercept_service(_continuation(sentinel), _details(method, metadata))
    )


def _continuation(handler):
    async def call(details):
        return handler

    return call


def _denied_code(handler) -> grpc.StatusCode:
    """Drive the denied unary behavior through a real abort and read it back."""
    context = _RecordingContext()
    with pytest.raises(_AbortRecorded):
        asyncio.run(handler.unary_unary(None, context))
    return context.code


def _denied_stream_code(handler) -> grpc.StatusCode:
    context = _RecordingContext()
    stream = handler.unary_stream(None, context)
    with pytest.raises(_AbortRecorded):
        asyncio.run(stream.__anext__())
    return context.code


def test_the_health_methods_pass_open_without_a_key() -> None:
    sentinel = _unary_handler()

    assert _intercept(_HEALTH_CHECK, handler=sentinel) is sentinel
    assert _intercept(_HEALTH_WATCH, handler=sentinel) is sentinel


def test_a_matching_key_passes_through() -> None:
    sentinel = _unary_handler()

    handler = _intercept(_DETECT, metadata=(("x-api-key", _API_KEY),), handler=sentinel)

    assert handler is sentinel


def test_metadata_keys_match_case_insensitively() -> None:
    sentinel = _unary_handler()

    handler = _intercept(_DETECT, metadata=(("X-API-KEY", _API_KEY),), handler=sentinel)

    assert handler is sentinel


def test_a_missing_key_denies() -> None:
    handler = _intercept(_DETECT)

    assert handler.unary_unary is not None
    assert _denied_code(handler) == grpc.StatusCode.UNAUTHENTICATED


def test_a_wrong_key_denies() -> None:
    handler = _intercept(_DETECT, metadata=(("x-api-key", "wrong-key-16chars"),))

    assert _denied_code(handler) == grpc.StatusCode.UNAUTHENTICATED


def test_a_non_string_key_denies() -> None:
    handler = _intercept(_DETECT, metadata=(("x-api-key", b"raw-bytes"),))

    assert _denied_code(handler) == grpc.StatusCode.UNAUTHENTICATED


def test_the_deny_preserves_a_streaming_shape() -> None:
    handler = _intercept(_DETECT, handler=_streaming_handler())

    assert handler.response_streaming is True
    assert handler.unary_stream is not None
    assert _denied_stream_code(handler) == grpc.StatusCode.UNAUTHENTICATED


def test_an_unknown_method_still_denies() -> None:
    handler = asyncio.run(
        ApiKeyAuthInterceptor(_API_KEY).intercept_service(_continuation(None), _details(_DETECT))
    )

    assert handler is not None
    assert _denied_code(handler) == grpc.StatusCode.UNAUTHENTICATED
