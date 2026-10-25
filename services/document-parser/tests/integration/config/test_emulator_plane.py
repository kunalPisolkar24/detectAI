"""The prod plane through the real FLoCI endpoint, driven by the boot path.

deployment_flick -> ConfigFactory.create -> Settings.from_provider run
against the seeded emulator planes — the end its pure siblings in
tests/unit/config only pretend to cover. Skipped when the emulator
(compose brings FLoCI up on :4566) is unreachable: a local docker stack
is environment, not test setup.
"""

import socket
from pathlib import Path

import pytest

from app.config import ConfigFactory, Settings, deployment_flick

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _floci_reachable() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 4566), timeout=1.0):
            return True
    except OSError:
        return False


def _env_values() -> dict[str, str]:
    values: dict[str, str] = {}
    text = (_REPO_ROOT / "infra" / ".env").read_text()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, raw = line.partition("=")
        values[key.strip()] = raw.split("#")[0].strip()
    return values


requires_floci = pytest.mark.skipif(not _floci_reachable(), reason="Floci not reachable on :4566")


@requires_floci
def test_prod_flick_boots_off_the_seeded_floci_plane(monkeypatch: pytest.MonkeyPatch) -> None:
    env = _env_values()
    monkeypatch.setenv("ENV_TYPE", "prod")
    monkeypatch.setenv("AWS_REGION", env["AWS_REGION"])
    monkeypatch.setenv("EMULATOR_ENDPOINT", "http://localhost:4566")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    provider = ConfigFactory.create(deployment_flick())
    settings = Settings.from_provider(provider)

    assert settings.api_key == env["API_KEY"]
