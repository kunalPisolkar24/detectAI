"""Factory wiring: the flick composes the right plane, the prod build fetches
over the bootstrap environment, and the emulator's seeded plane ends-to-end
through the same path (integration, skipped when Floci is unreachable).
"""

import json
import socket
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.config import ConfigFactory, ProdConfig, Settings, deployment_flick
from app.config.errors import ConfigFetchError
from app.config.factories.aws_client_factory import AWSClientFactory
from app.config.provider import DevConfig


def test_prod_wiring_builds_both_aws_planes_secrets_first(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_REGION", "ap-southeast-2")
    built: list[str] = []

    class FakeSecrets:
        def get_secret_value(self, **kwargs: Any) -> dict[str, Any]:
            return {"SecretString": json.dumps({"API_KEY": "k" * 20})}

    class FakeSsm:
        def get_paginator(self, operation: str) -> Any:
            return SimpleNamespace(paginate=lambda **kw: iter([{"Parameters": []}]))

    def fake_client(service: str) -> Any:
        built.append(service)
        return FakeSecrets() if service == "secretsmanager" else FakeSsm()

    monkeypatch.setattr(AWSClientFactory, "create_client", lambda self, service: fake_client(service))

    provider = ConfigFactory.create("prod")

    assert isinstance(provider, ProdConfig)
    assert built == ["secretsmanager", "ssm"]  # the secret plane fails before SSM is even built
    assert provider.get("API_KEY") == "k" * 20


def test_dev_wiring_never_touches_the_aws_side(monkeypatch: pytest.MonkeyPatch) -> None:
    def not_built(*args: object, **kwargs: object) -> None:
        raise AssertionError("aws reads on the dev flick")

    monkeypatch.setattr(AWSClientFactory, "from_env", classmethod(not_built))

    assert isinstance(ConfigFactory.create("dev"), DevConfig)


def test_a_garbage_flick_warns_and_boots_the_dev_plane(
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    with caplog.at_level(logging.WARNING):
        ConfigFactory.create("staging")
    assert any("neither dev nor prod" in record.getMessage() for record in caplog.records)


def test_from_env_fails_without_region(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AWS_REGION", raising=False)

    with pytest.raises(ConfigFetchError, match="AWS_REGION"):
        AWSClientFactory.from_env()


def test_from_env_reads_region_and_trims_the_emulator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_REGION", "ap-southeast-2")
    monkeypatch.setenv("EMULATOR_ENDPOINT", " http://localhost:4566 ")

    factory = AWSClientFactory.from_env()
    assert factory._region == "ap-southeast-2"
    assert factory._endpoint_url == "http://localhost:4566"


def test_create_client_shares_region_and_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeBoto:
        def __init__(self) -> None:
            self.calls: list[tuple[str, dict[str, Any]]] = []

        def client(self, service: str, **kwargs: Any) -> str:
            self.calls.append((service, kwargs))
            return f"client:{service}"

    boto = FakeBoto()
    monkeypatch.setitem(sys.modules, "boto3", boto)
    factory = AWSClientFactory("ap-southeast-2", endpoint_url="http://localhost:4566")

    factory.create_client("ssm")
    factory.create_client("secretsmanager")

    assert boto.calls == [
        ("ssm", {"region_name": "ap-southeast-2", "endpoint_url": "http://localhost:4566"}),
        ("secretsmanager", {"region_name": "ap-southeast-2", "endpoint_url": "http://localhost:4566"}),
    ]


def _floci_reachable() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", 4566), timeout=1.0):
            return True
    except OSError:
        return False


def _env_values() -> dict[str, str]:
    values: dict[str, str] = {}
    text = (Path(__file__).resolve().parents[1] / "infra" / ".env").read_text()
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
