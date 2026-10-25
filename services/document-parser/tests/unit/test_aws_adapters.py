"""The two AWS adapters against fake clients: fetch-once-and-cache, plain
parameter extraction, the blob-shape contract, and loud failures that name
the stack and the fix.
"""

import json
from typing import Any

import pytest
from botocore.exceptions import ClientError

from app.config.adapters.parameters import ParameterStoreAdapter
from app.config.adapters.secrets_manager import SecretsManagerAdapter
from app.config.errors import ConfigFetchError

PAGE = {"Parameters": [
    {"Name": "/detectai/document-parser/MAX_PDF_PAGES", "Value": "1000", "Type": "String"},
    {"Name": "/detectai/document-parser/LOG_LEVEL", "Value": "INFO", "Type": "String"},
]}


class FakeClient:
    """Answers both planes' calls and records every kwarg they pass."""

    def __init__(
        self,
        *,
        secret: str | None = None,
        secret_error: Exception | None = None,
        pages: list[dict[str, Any]] | None = None,
        ssm_error: Exception | None = None,
    ) -> None:
        self._calls: list[tuple[str, Any]] = []
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

    def calls(self) -> list[tuple[str, Any]]:
        return list(self._calls)

    def call_names(self) -> list[str]:
        return [name for name, _ in self._calls]


class FakePaginator:
    def __init__(
        self, calls: list[tuple[str, Any]], pages: list[dict[str, Any]], error: Exception | None
    ) -> None:
        self._calls = calls
        self._pages = pages
        self._error = error

    def paginate(self, **kwargs: Any):
        self._calls.append(("paginate", kwargs))
        if self._error is not None:
            raise self._error
        return iter(self._pages)


def _missing_secret() -> ClientError:
    return ClientError(
        {"Error": {"Code": "ResourceNotFoundException", "Message": "missing"}}, "GetSecretValue"
    )


def _ssm_error() -> ClientError:
    return ClientError({"Error": {"Code": "AccessDeniedException", "Message": "nope"}}, "GetParametersByPath")


def test_parameters_are_fetched_over_paged_calls_and_prefix_stripped() -> None:
    client = FakeClient(pages=[PAGE, {"Parameters": [
        {"Name": "/detectai/document-parser/MAX_TEXT_LENGTH", "Value": "7", "Type": "String"},
    ]}])

    values = ParameterStoreAdapter(client).fetch()

    assert values == {"MAX_PDF_PAGES": "1000", "LOG_LEVEL": "INFO", "MAX_TEXT_LENGTH": "7"}
    assert client.call_names() == ["get_paginator", "paginate"]
    paginate_kwargs = [kwargs for name, kwargs in client.calls() if name == "paginate"]
    assert paginate_kwargs == [{
        "Path": "/detectai/document-parser/",
        "Recursive": True,
        "WithDecryption": False,
    }]


def test_an_empty_ssm_path_is_an_empty_plane_not_an_error() -> None:
    values = ParameterStoreAdapter(FakeClient(pages=[{"Parameters": []}])).fetch()

    assert values == {}


def test_unread_keys_answer_default_not_error() -> None:
    adapter = ParameterStoreAdapter(FakeClient(pages=[PAGE]))

    assert adapter.get("MAX_PDF_PAGES") == "1000"
    assert adapter.get("MISSING") is None
    assert adapter.get("MISSING", "fallback") == "fallback"


def test_fetch_returns_a_copy_independent_of_the_cache() -> None:
    adapter = ParameterStoreAdapter(FakeClient(pages=[PAGE]))

    first = adapter.fetch()
    first["MAX_PDF_PAGES"] = "poisoned"
    first["INJECTED"] = "poisoned"

    assert adapter.fetch()["MAX_PDF_PAGES"] == "1000"
    assert "INJECTED" not in adapter.fetch()


def test_a_securestring_on_the_config_plane_fails_loud() -> None:
    pages = [{"Parameters": [{
        "Name": "/detectai/document-parser/API_KEY", "Value": "*", "Type": "SecureString",
    }]}]

    with pytest.raises(ConfigFetchError, match="SecureString"):
        ParameterStoreAdapter(FakeClient(pages=pages))


def test_an_ssm_failure_fails_loud_with_path_and_fix() -> None:
    client = FakeClient(ssm_error=_ssm_error())

    with pytest.raises(ConfigFetchError, match="/detectai/document-parser/") as excinfo:
        ParameterStoreAdapter(client)
    assert "secrets-apply" in str(excinfo.value)


def test_the_blob_is_fetched_once_exactly() -> None:
    client = FakeClient(secret=json.dumps({"API_KEY": "k" * 24}))

    adapter = SecretsManagerAdapter(client)

    assert adapter.get("API_KEY") == "k" * 24
    assert client.call_names() == ["get_secret_value"]


def test_a_missing_secret_fails_loud_with_the_fix() -> None:
    client = FakeClient(secret_error=_missing_secret())

    with pytest.raises(ConfigFetchError, match="detectai/document-parser/secrets") as excinfo:
        SecretsManagerAdapter(client)
    assert "secrets-apply" in str(excinfo.value)


def test_a_blob_without_secret_string_is_a_broken_contract() -> None:
    client = FakeClient(secret=None)

    with pytest.raises(ConfigFetchError, match="no SecretString"):
        SecretsManagerAdapter(client)


@pytest.mark.parametrize("blob", ["not json", '["not", "a", "blob"]'])
def test_the_blob_must_be_a_json_object(blob: str) -> None:
    client = FakeClient(secret=blob)

    with pytest.raises(ConfigFetchError, match="JSON blob"):
        SecretsManagerAdapter(client)
