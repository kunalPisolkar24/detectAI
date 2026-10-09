import pytest
from pydantic import ValidationError

from src.infrastructure.config import Settings


def test_settings_accepts_comma_separated_inference_providers():
    settings = Settings(
        API_KEY="test-secret-key-16chars",
        INFERENCE_PROVIDERS="CPUExecutionProvider, CUDAExecutionProvider",
    )

    assert settings.INFERENCE_PROVIDERS == [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
    ]


def test_settings_accepts_json_array_inference_providers():
    settings = Settings(
        API_KEY="test-secret-key-16chars",
        INFERENCE_PROVIDERS='["CPUExecutionProvider", "CUDAExecutionProvider"]',
    )

    assert settings.INFERENCE_PROVIDERS == [
        "CPUExecutionProvider",
        "CUDAExecutionProvider",
    ]


def test_settings_rejects_empty_inference_providers():
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key-16chars", INFERENCE_PROVIDERS=" , ")


def test_settings_require_api_key(monkeypatch):
    monkeypatch.delenv("API_KEY", raising=False)

    with pytest.raises(ValidationError):
        Settings()


def test_settings_include_pinned_model_revisions():
    settings = Settings(API_KEY="test-secret-key-16chars")

    assert settings.SPARK_MODEL_REVISION == "9a48004391c71272d6fb1d164ed7c56e1fbfe360"
    assert settings.FLARE_MODEL_REVISION == "e1911c0be59f4e10f0d120f639d1358e46bc2086"


def test_settings_default_ort_tuning():
    settings = Settings(API_KEY="test-secret-key-16chars")

    assert settings.ORT_INTRA_OP_THREADS == 1
    assert settings.ORT_INTER_OP_THREADS == 1
    assert settings.ORT_GRAPH_OPT_LEVEL == "all"
    assert settings.ORT_EXECUTION_MODE == "sequential"
    assert settings.ORT_WARMUP_ENABLED is True


def test_settings_reject_invalid_ort_options():
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key-16chars", ORT_GRAPH_OPT_LEVEL="turbo")
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key-16chars", ORT_EXECUTION_MODE="sideways")


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
        ("MAX_TEXT_CHARS", 0),
        ("MAX_GLOBAL_TOKENS", 0),
        ("CHUNK_TOKEN_LIMIT", 0),
        ("CHUNK_TOKEN_STRIDE", 0),
    ],
)
def test_settings_reject_non_positive_numeric_values(field_name, value):
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key-16chars", **{field_name: value})


def test_settings_reject_stride_greater_than_chunk_limit():
    with pytest.raises(ValidationError, match="CHUNK_TOKEN_STRIDE"):
        Settings(
            API_KEY="test-secret-key-16chars",
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
        Settings(API_KEY="test-secret-key-16chars", **{field_name: value})


def test_settings_batch_resolvers_fall_back_to_shared_defaults():
    settings = Settings(API_KEY="test-secret-key-16chars")

    assert settings.batch_size_for("spark") == settings.BATCH_SIZE
    assert settings.batch_size_for("flare") == settings.BATCH_SIZE
    assert settings.batch_timeout_for("spark") == settings.BATCH_TIMEOUT
    assert settings.batch_timeout_for("flare") == settings.BATCH_TIMEOUT


def test_settings_batch_resolvers_prefer_model_overrides():
    settings = Settings(
        API_KEY="test-secret-key-16chars",
        SPARK_BATCH_SIZE=8,
        SPARK_BATCH_TIMEOUT=0.01,
        FLARE_BATCH_SIZE=64,
        FLARE_BATCH_TIMEOUT=0.2,
    )

    assert settings.batch_size_for("spark") == 8
    assert settings.batch_timeout_for("spark") == 0.01
    assert settings.batch_size_for("flare") == 64
    assert settings.batch_timeout_for("flare") == 0.2


def test_settings_reject_model_batch_size_above_queue():
    with pytest.raises(ValidationError, match="BATCH_QUEUE_MAX_SIZE"):
        Settings(
            API_KEY="test-secret-key-16chars",
            BATCH_QUEUE_MAX_SIZE=8,
            FLARE_BATCH_SIZE=16,
        )


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("SPARK_BATCH_SIZE", 0),
        ("SPARK_BATCH_SIZE", 513),
        ("SPARK_BATCH_TIMEOUT", 0),
        ("FLARE_BATCH_SIZE", 0),
        ("FLARE_BATCH_TIMEOUT", 11),
    ],
)
def test_settings_reject_out_of_range_model_batch_values(field_name, value):
    with pytest.raises(ValidationError):
        Settings(API_KEY="test-secret-key-16chars", **{field_name: value})
