"""Settings through a config plane: provider values win over the process
environment, a missing or invalid required key fails the boot on the field's
own contract, undeclared plane keys are ignored, and the flick stays
fail-closed.
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import ConfigProvider, Settings, deployment_flick
from app.config.adapters import dotenv as dotenv_module
from app.config.adapters.dotenv import DotEnvAdapter
from app.config.provider import DevConfig


class StubProvider(ConfigProvider):
    """Stands in for a plane in the composed chain: a plain dict lookup."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)

    def require(self, key: str) -> str:
        value = self._values.get(key)
        if value is None:
            raise AssertionError(f"stub was asked for unseeded {key}")
        return value


def test_provider_values_win_over_a_poisoned_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_KEY", "a" * 20)

    settings = Settings.from_provider(StubProvider({"API_KEY": "b" * 20}))

    assert settings.api_key == "b" * 20


def test_a_dev_plane_off_the_process_env_fills_the_required_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fileless container shape: the dotenv default is absent, composition
    # injected the values as env vars, and they flow provider -> Settings.
    monkeypatch.delenv(dotenv_module.DOTENV_PATH_VAR, raising=False)
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", tmp_path / "absent" / ".env")
    monkeypatch.setenv("API_KEY", "a" * 20)

    settings = Settings.from_provider(DevConfig(DotEnvAdapter()))

    assert settings.api_key == "a" * 20


def test_an_unseeded_required_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({}))


def test_a_short_required_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({"API_KEY": "short"}))


def test_undeclared_plane_keys_ride_and_drop() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "MAX_PDF_PAGES": "9999",
            "WORKER_THREADS": "4",
            "ENV_TYPE": "prod",  # the flick stays off the model
        })
    )

    assert settings.api_key == "a" * 20
    assert not hasattr(settings, "env_type")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("prod", "prod"),
        ("PROD", "prod"),
        (" prod ", "prod"),
        ("dev", "dev"),
        ("production", "dev"),
        ("", "dev"),
    ],
)
def test_deployment_flick_is_fail_closed(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: str
) -> None:
    monkeypatch.setenv("ENV_TYPE", raw)
    assert deployment_flick() == expected
