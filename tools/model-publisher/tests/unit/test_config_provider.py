from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.infrastructure.config.provider import clear_settings_cache, get_settings
from src.infrastructure.config.settings import Settings


def test_settings_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setenv("HF_USERNAME", "alice")
    clear_settings_cache()
    with pytest.raises(ValidationError):
        Settings()
    # also via provider
    with pytest.raises((ValidationError, ValueError)):
        get_settings()


def test_settings_rejects_placeholder_token() -> None:
    with pytest.raises(ValidationError):
        Settings(hf_token="not-configured", hf_username="alice")
    with pytest.raises(ValidationError):
        Settings(hf_token="test", hf_username="alice")


def test_settings_env_ignore_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HF_TOKEN", "")
    monkeypatch.setenv("HF_USERNAME", "alice")
    clear_settings_cache()
    # empty should be treated as missing -> validation error, not "" value
    with pytest.raises((ValidationError, ValueError)):
        get_settings()


def test_settings_trims_and_loads(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HF_TOKEN", "  hf_abc12345  ")
    monkeypatch.setenv("HF_USERNAME", "  bob  ")
    clear_settings_cache()
    s = get_settings()
    assert s.hf_token == "hf_abc12345"
    assert s.hf_username == "bob"


def test_provider_caches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HF_TOKEN", "hf_cachetest123")
    monkeypatch.setenv("HF_USERNAME", "alice")
    clear_settings_cache()
    a = get_settings()
    b = get_settings()
    assert a is b
    clear_settings_cache()
    c = get_settings()
    assert c is not b
