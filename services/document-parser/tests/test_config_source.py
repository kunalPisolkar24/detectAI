"""AwsConfigSource against fake clients (unit) and against the seeded Floci
plane (integration, skipped when the daemon is not reachable).
"""

import json
import socket
import types
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from botocore.exceptions import ClientError

from app import config_source as cs
from app.config import Settings


class FakeClient:
    def __init__(
        self,
        calls: list[tuple[str, dict[str, Any]]],
        *,
        secret: str | None = None,
        secret_error: Exception | None = None,
        pages: list[dict[str, Any]] | None = None,
        ssm_error: Exception | None = None,
    ) -> None:
        self._calls = calls
        self._secret = secret
        self._secret_error = secret_error
        self._pages = pages or []
        self._ssm_error = ssm_error

    def get_secret_value(self, **kwargs: Any) -> dict[str, Any]:
        self._calls.append(("get_secret_value", kwargs))
        if self._secret_error is not None:
            raise self._secret_error
        return {"SecretString": self._secret}

    def get_paginator(self, operation: str) -> "FakePaginator":
        self._calls.append(("get_paginator", {"operation": operation}))
        return FakePaginator(self._calls, self._pages, self._ssm_error)


class FakePaginator:
    def __init__(
        self,
        calls: list[tuple[str, dict[str, Any]]],
        pages: list[dict[str, Any]],
        error: Exception | None,
    ) -> None:
        self._calls = calls
        self._pages = pages
        self._error = error

    def paginate(self, **kwargs: Any) -> Iterator[dict[str, Any]]:
        self._calls.append(("paginate", kwargs))
        if self._error is not None:
            raise self._error
        return iter(self._pages)


def _fake_boto(
    monkeypatch: pytest.MonkeyPatch, clients: dict[str, FakeClient]
) -> list[tuple[str, str, str | None]]:
    """Swap the module's boto3 seam for a factory that builds the given fakes
    and records the client arguments (service, region, endpoint)."""
    calls: list[tuple[str, str, str | None]] = []

    def factory(service: str, *, region_name: str, endpoint_url: str | None) -> FakeClient:
        calls.append((service, region_name, endpoint_url))
        return clients[service]

    monkeypatch.setattr(cs, "boto3", types.SimpleNamespace(client=factory))
    return calls


def _missing_secret() -> ClientError:
    return ClientError(
        {"Error": {"Code": "ResourceNotFoundException", "Message": "missing"}}, "GetSecretValue"
    )


def _ssm_error() -> ClientError:
    return ClientError({"Error": {"Code": "AccessDeniedException", "Message": "nope"}}, "GetParametersByPath")


def test_call_merges_blob_and_ssm_stripping_the_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = {
        "secretsmanager": FakeClient([], secret=json.dumps({"API_KEY": "b" * 22})),
        "ssm": FakeClient(
            [],
            pages=[
                {
                    "Parameters": [
                        {"Name": "/detectai/document-parser/MAX_PDF_PAGES", "Value": "1000"},
                        {"Name": "/detectai/document-parser/LOG_LEVEL", "Value": "INFO"},
                    ]
                },
                {"Parameters": [{"Name": "/detectai/document-parser/MAX_TEXT_LENGTH", "Value": "7"}]},
            ],
        ),
    }
    calls = _fake_boto(monkeypatch, clients)

    values = cs.AwsConfigSource(Settings, "ap-southeast-2")()

    assert values["api_key"] == "b" * 22
    assert values["max_pdf_pages"] == "1000"
    assert values["max_text_length"] == "7"
    assert "log_level" not in values  # keys without a settings field are dropped
    assert not any("/detectai" in key for key in values)
    assert calls == [
        ("secretsmanager", "ap-southeast-2", None),
        ("ssm", "ap-southeast-2", None),
    ]


def test_endpoint_url_follows_the_emulator_plane(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = {
        "secretsmanager": FakeClient([], secret=json.dumps({"API_KEY": "b" * 22})),
        "ssm": FakeClient([], pages=[{"Parameters": [{"Name": "/detectai/document-parser/MAX_PDF_PAGES", "Value": "1000"}]}]),
    }
    calls = _fake_boto(monkeypatch, clients)

    values = cs.AwsConfigSource(Settings, "ap-southeast-2", "http://localhost:4566")()

    assert values["api_key"] == "b" * 22
    assert calls == [
        ("secretsmanager", "ap-southeast-2", "http://localhost:4566"),
        ("ssm", "ap-southeast-2", "http://localhost:4566"),
    ]


def test_missing_secret_fails_loud_with_the_fix(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = {"secretsmanager": FakeClient([], secret_error=_missing_secret())}
    _fake_boto(monkeypatch, clients)

    with pytest.raises(cs.ConfigSourceError, match="detectai/document-parser/secrets") as excinfo:
        cs.AwsConfigSource(Settings, "ap-southeast-2")()
    assert "secrets-apply" in str(excinfo.value)


def test_ssm_failure_fails_loud_with_the_fix(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = {
        "secretsmanager": FakeClient([], secret=json.dumps({"API_KEY": "b" * 22})),
        "ssm": FakeClient([], ssm_error=_ssm_error()),
    }
    _fake_boto(monkeypatch, clients)

    with pytest.raises(cs.ConfigSourceError, match="/detectai/document-parser/") as excinfo:
        cs.AwsConfigSource(Settings, "ap-southeast-2")()
    assert "secrets-apply" in str(excinfo.value)


@pytest.mark.parametrize("blob", ["not json", '["not", "a", "blob"]'])
def test_blob_must_be_a_json_object(monkeypatch: pytest.MonkeyPatch, blob: str) -> None:
    clients = {"secretsmanager": FakeClient([], secret=blob)}
    _fake_boto(monkeypatch, clients)

    with pytest.raises(cs.ConfigSourceError, match="JSON blob"):
        cs.AwsConfigSource(Settings, "ap-southeast-2")()


def test_missing_secret_string_is_a_broken_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    clients = {"secretsmanager": FakeClient([], secret=None)}
    _fake_boto(monkeypatch, clients)

    with pytest.raises(cs.ConfigSourceError, match="no SecretString"):
        cs.AwsConfigSource(Settings, "ap-southeast-2")()


def test_from_env_fails_without_region(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("EMULATOR_ENDPOINT", raising=False)

    with pytest.raises(cs.ConfigSourceError, match="AWS_REGION"):
        cs.AwsConfigSource.from_env(Settings)


def test_from_env_reads_region_and_trims_the_emulator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AWS_REGION", "ap-southeast-2")
    monkeypatch.setenv("EMULATOR_ENDPOINT", " http://localhost:4566 ")

    source = cs.AwsConfigSource.from_env(Settings)
    assert source._region == "ap-southeast-2"
    assert source._endpoint_url == "http://localhost:4566"


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
def test_prod_source_matches_the_seeded_plane(monkeypatch: pytest.MonkeyPatch) -> None:
    env = _env_values()
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    source = cs.AwsConfigSource(Settings, env["AWS_REGION"], "http://localhost:4566")

    values = source()

    assert values["api_key"] == env["API_KEY"]
    for key in (
        "max_upload_size_bytes",
        "process_budget_seconds",
        "max_pdf_pages",
        "max_docx_uncompressed_bytes",
        "max_text_length",
        "otel_exporter_otlp_endpoint",
        "otel_service_name",
    ):
        # .env speaks env names (upper); the source emits field names.
        assert values[key] == env[key.upper()]


@requires_floci
def test_prod_flick_boots_off_the_seeded_plane(monkeypatch: pytest.MonkeyPatch) -> None:
    env = _env_values()
    monkeypatch.setenv("ENV_TYPE", "prod")
    monkeypatch.setenv("AWS_REGION", env["AWS_REGION"])
    monkeypatch.setenv("EMULATOR_ENDPOINT", "http://localhost:4566")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")

    settings = Settings()

    assert settings.env_type == "prod"
    assert settings.api_key == env["API_KEY"]
    assert settings.max_pdf_pages == int(env["MAX_PDF_PAGES"])
