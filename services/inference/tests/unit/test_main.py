"""The entry point: the boot stages run in order, the plane picks reflection,
and the runtime pools and observability drain even when serving fails.
"""

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from app import main as entry
from app.config import Settings
from app.inference.analysis import DocumentAnalysis


class _Boom(RuntimeError):
    pass


def _settings() -> Settings:
    return Settings.model_validate({"api_key": "a" * 20})


@pytest.fixture
def boot(monkeypatch: pytest.MonkeyPatch) -> dict[str, list[Any]]:
    """Replace every boot stage with a recorder; return the shared call log."""
    calls: dict[str, list[Any]] = {"calls": [], "run_server": []}
    settings = _settings()
    observability = SimpleNamespace(shutdown=lambda: calls["calls"].append("shutdown"))
    interceptor = object()
    wiring = SimpleNamespace(observability=observability, server_interceptor=interceptor)
    runtime = SimpleNamespace(key="spark", max_inflight=2)

    def record(name: str, result: Any):
        def stage(*args: Any, **kwargs: Any) -> Any:
            calls["calls"].append(name)
            return result

        return stage

    monkeypatch.setattr(entry, "resolve_plane", record("plane", "dev"))
    monkeypatch.setattr(entry, "resolve_settings", record("settings", settings))
    monkeypatch.setattr(entry, "build_observability_service", record("observability", wiring))
    monkeypatch.setattr(entry, "ensure_model_artifacts", record("artifacts", {"spark": object()}))
    monkeypatch.setattr(entry, "load_models", record("load", {"spark": object()}))
    monkeypatch.setattr(entry, "build_runtimes", record("runtimes", {"spark": runtime}))
    monkeypatch.setattr(entry, "warm_runtimes", record("warm", None))
    monkeypatch.setattr(entry, "close_runtimes", record("close", None))

    def info(message: str, *args: object) -> None:
        if message == "inference shutdown complete":
            calls["calls"].append("shutdown log")

    monkeypatch.setattr(entry, "logger", SimpleNamespace(info=info))

    async def run_server(**kwargs: Any) -> None:
        calls["calls"].append("serve")
        calls["run_server"].append(kwargs)

    monkeypatch.setattr(entry, "run_server", run_server)
    return calls


def test_the_boot_stages_run_in_order(boot: dict[str, list[Any]]) -> None:
    asyncio.run(entry.main())

    assert boot["calls"] == [
        "plane",
        "settings",
        "observability",
        "artifacts",
        "load",
        "runtimes",
        "warm",
        "serve",
        "close",
        "shutdown log",
        "shutdown",
    ]


def test_the_server_gets_the_boot_outputs(boot: dict[str, list[Any]]) -> None:
    asyncio.run(entry.main())

    kwargs = boot["run_server"][0]
    settings = _settings()
    assert kwargs["port"] == settings.grpc_port
    assert kwargs["api_key"] == settings.api_key
    assert kwargs["max_inflight_requests"] == settings.max_inflight_requests
    assert kwargs["enable_reflection"] is True
    assert isinstance(kwargs["analysis"], DocumentAnalysis)
    assert kwargs["observability"] is not None
    assert kwargs["server_interceptor"] is not None


@pytest.mark.parametrize("plane,reflection", [("dev", True), ("prod", False)])
def test_reflection_follows_the_plane(
    boot: dict[str, list[Any]],
    monkeypatch: pytest.MonkeyPatch,
    plane: str,
    reflection: bool,
) -> None:
    monkeypatch.setattr(entry, "resolve_plane", lambda: plane)

    asyncio.run(entry.main())

    assert boot["run_server"][0]["enable_reflection"] is reflection


def test_the_pools_and_observability_close_when_serving_fails(
    boot: dict[str, list[Any]], monkeypatch: pytest.MonkeyPatch
) -> None:
    async def failing_server(**kwargs: Any) -> None:
        boot["calls"].append("serve")
        raise _Boom("the server died")

    monkeypatch.setattr(entry, "run_server", failing_server)

    with pytest.raises(_Boom, match="the server died"):
        asyncio.run(entry.main())

    assert boot["calls"][-3:] == ["close", "shutdown log", "shutdown"]
