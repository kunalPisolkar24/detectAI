"""Settings source-chain behavior: the dev flick keeps pydantic's default
chain (and never builds the AWS source), the prod flick composes AWS exactly
— no process env, no dotenv — with field defaults still falling through.
"""

from typing import Any

import pytest
from pydantic import ValidationError

from app import config_source
from app.config import Settings, deployment_flick


class StubAwsSource:
    """Stands in for AwsConfigSource in the composed chain; the runtime only
    needs a zero-arg callable returning a mapping keyed by field name."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def __call__(self) -> dict[str, Any]:
        return self._values


def _stub_prod_fetch(monkeypatch: pytest.MonkeyPatch, values: dict[str, str]) -> None:
    monkeypatch.setattr(
        config_source.AwsConfigSource,
        "from_env",
        classmethod(lambda cls, settings_cls: StubAwsSource(values)),
    )


def test_dev_flick_keeps_the_default_chain_and_never_fetches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_KEY", "a" * 20)
    monkeypatch.setenv("ENV_TYPE", "dev")

    def not_built(*args: object, **kwargs: object) -> None:
        raise AssertionError("aws source built on the dev plane")

    monkeypatch.setattr(config_source.AwsConfigSource, "from_env", classmethod(not_built))
    assert Settings().api_key == "a" * 20  # process env beats dotenv, as today


def test_prod_flick_is_aws_exact(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV_TYPE", "prod")
    monkeypatch.setenv("API_KEY", "a" * 20)  # poisoned container env
    monkeypatch.setenv("MAX_PDF_PAGES", "9999")  # poisoned container env
    _stub_prod_fetch(monkeypatch, {"api_key": "b" * 22, "max_pdf_pages": "1000"})

    settings = Settings()
    assert settings.api_key == "b" * 22
    assert settings.max_pdf_pages == 1000
    assert settings.env_type == "prod"


def test_prod_flick_unseeded_key_falls_to_the_field_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV_TYPE", "prod")
    monkeypatch.setenv("PROCESS_BUDGET_SECONDS", "3.5")
    _stub_prod_fetch(monkeypatch, {"api_key": "b" * 22})

    # The key is absent from AWS and container env is out of the chain, so
    # only the field's safe default can answer — 3.5 may not leak in.
    assert Settings().process_budget_seconds == 10.0


def test_prod_flick_loses_the_boot_without_a_valid_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV_TYPE", "prod")
    _stub_prod_fetch(monkeypatch, {})

    with pytest.raises(ValidationError):
        Settings()


def test_prod_flick_needs_the_region(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV_TYPE", "prod")
    monkeypatch.delenv("AWS_REGION", raising=False)

    with pytest.raises(config_source.ConfigSourceError, match="AWS_REGION"):
        Settings()


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
