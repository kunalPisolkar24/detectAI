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
