import pytest
from pydantic import ValidationError

from src.config import Settings


def test_settings_accepts_comma_separated_inference_providers():
    settings = Settings(
        API_KEY="test-secret-key",
        INFERENCE_PROVIDERS="CPUExecutionProvider, CUDAExecutionProvider",
    )

    assert settings.INFERENCE_PROVIDERS == [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
    ]


def test_settings_accepts_json_array_inference_providers():
    settings = Settings(
        API_KEY="test-secret-key",
        INFERENCE_PROVIDERS='["CPUExecutionProvider", "CUDAExecutionProvider"]',
    )

    assert settings.INFERENCE_PROVIDERS == [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
    ]


def test_settings_rejects_empty_inference_providers():
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key", INFERENCE_PROVIDERS=" , ")


def test_settings_require_api_key(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)

    with pytest.raises(ValidationError):
        Settings()


def test_settings_include_pinned_model_revisions():
    settings = Settings(API_KEY="test-secret-key")

    assert settings.SPARK_MODEL_REVISION == "9a48004391c71272d6fb1d164ed7c56e1fbfe360"
    assert settings.FLARE_MODEL_REVISION == "e1911c0be59f4e10f0d120f639d1358e46bc2086"
