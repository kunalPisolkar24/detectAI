"""Factory wiring against fakes only: the flick composes the right plane,
prod wiring builds the secret plane before SSM is even constructed, and
the bootstrap environment read decides region and the emulator override.
No network, no boot — the real-plane equivalent lives beside its kin in
tests/integration/config (FLoCI).
"""

import json
import sys
from types import SimpleNamespace
from typing import Any

import pytest

from app.config import ConfigFactory, ProdConfig
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
