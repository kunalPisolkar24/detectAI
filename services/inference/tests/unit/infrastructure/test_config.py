import pytest
from pydantic import ValidationError

from src.infrastructure.config import Settings


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


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("GRPC_PORT", 0),
        ("METRICS_PORT", 0),
        ("GRPC_MAX_WORKERS", 0),
        ("BATCH_SIZE", 0),
        ("BATCH_TIMEOUT", 0),
        ("BATCH_QUEUE_MAX_SIZE", 0),
        ("MAX_INFLIGHT_DOC_CHUNKS", 0),
        ("MAX_TEXT_LENGTH", 0),
        ("MAX_GLOBAL_TOKENS", 0),
        ("CHUNK_TOKEN_LIMIT", 0),
        ("CHUNK_TOKEN_STRIDE", 0),
    ],
)
def test_settings_reject_non_positive_numeric_values(field_name, value):
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key", **{field_name: value})


def test_settings_reject_stride_greater_than_chunk_limit():
    with pytest.raises(ValidationError, match="CHUNK_TOKEN_STRIDE"):
        Settings(
            API_KEY="test-secret-key",
            CHUNK_TOKEN_LIMIT=128,
            CHUNK_TOKEN_STRIDE=192,
        )


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("SPARK_MODEL_REVISION", "main"),
        ("SPARK_MODEL_REVISION", "9A48004391C71272D6FB1D164ED7C56E1FBFE360"),
        ("FLARE_MODEL_REVISION", "e1911c0be59f4e10f0d120f639d1358e46bc208"),
    ],
)
def test_settings_reject_non_immutable_model_revisions(field_name, value):
    with pytest.raises(ValidationError, match="40-character lowercase git SHAs"):
        Settings(API_KEY="test-secret-key", **{field_name: value})
