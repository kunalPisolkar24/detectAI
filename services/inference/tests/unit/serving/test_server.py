"""The process-level server wiring: run_server's hand-offs, the signal that
stops it, and the bind failure that must kill the boot before it serves.
"""

import asyncio
import signal
from typing import Any

import pytest

from app.serving import server


def test_run_server_hands_the_boot_outputs_to_the_server(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, Any]] = []
    built = (object(), object(), 50051)
    stop = object()
    analysis = object()
    interceptor = object()
    observability = object()

    def build(*args: Any) -> tuple[object, object, int]:
        calls.append(("build", args))
        return built

    def wait_for_signal() -> object:
        calls.append(("signal", None))
        return stop

    async def serve_until_stopped(*args: Any) -> None:
        calls.append(("serve", args))

    monkeypatch.setattr(server, "_build", build)
    monkeypatch.setattr(server, "_wait_for_signal", wait_for_signal)
    monkeypatch.setattr(server, "_serve_until_stopped", serve_until_stopped)

    asyncio.run(
        server.run_server(
            port=50051,
            api_key="a" * 20,
            analysis=analysis,  # type: ignore[arg-type]
            max_inflight_requests=4,
            enable_reflection=True,
            server_interceptor=interceptor,  # type: ignore[arg-type]
            observability=observability,  # type: ignore[arg-type]
        )
    )

    assert calls[0] == (
        "build",
        (50051, "a" * 20, analysis, 4, True, interceptor, observability),
    )
    assert calls[1] == ("signal", None)
    assert calls[2] == ("serve", (built[0], built[1], stop, analysis))


def test_both_termination_signals_set_the_stop_event(monkeypatch: pytest.MonkeyPatch) -> None:
    registered: dict[signal.Signals, Any] = {}

    class Loop:
        def add_signal_handler(self, sig: signal.Signals, handler: Any) -> None:
            registered[sig] = handler

    monkeypatch.setattr(server.asyncio, "get_running_loop", lambda: Loop())

    async def scenario() -> asyncio.Event:
        return server._wait_for_signal()

    stop = asyncio.run(scenario())

    assert set(registered) == {signal.SIGTERM, signal.SIGINT}
    registered[signal.SIGTERM]()
    assert stop.is_set()


def test_the_signal_fallback_works_on_loops_without_signal_support(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registered: dict[signal.Signals, Any] = {}

    class Loop:
        def add_signal_handler(self, sig: signal.Signals, handler: Any) -> None:
            raise NotImplementedError

    monkeypatch.setattr(server.asyncio, "get_running_loop", lambda: Loop())
    monkeypatch.setattr(
        server.signal,
        "signal",
        lambda sig, handler: registered.__setitem__(sig, handler),
    )

    async def scenario() -> asyncio.Event:
        return server._wait_for_signal()

    stop = asyncio.run(scenario())

    assert set(registered) == {signal.SIGTERM, signal.SIGINT}
    registered[signal.SIGINT]()
    assert stop.is_set()


def test_a_port_that_cannot_bind_kills_the_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeServer:
        def add_insecure_port(self, address: str) -> int:
            return 0

    monkeypatch.setattr(server.aio, "server", lambda **kwargs: FakeServer())
    monkeypatch.setattr(server.health_pb2_grpc, "add_HealthServicer_to_server", lambda *a: None)
    monkeypatch.setattr(server.pb_grpc, "add_AIServiceServicer_to_server", lambda *a: None)

    with pytest.raises(RuntimeError, match="failed to bind port 50051"):
        server._build(
            50051,
            "a" * 20,
            object(),  # type: ignore[arg-type]
            4,
        )
