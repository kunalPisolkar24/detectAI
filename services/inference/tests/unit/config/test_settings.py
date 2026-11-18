"""Settings through a config plane: provider values win over the process
environment, a missing or invalid required key fails the boot on the field's
own contract, undeclared plane keys are ignored, and the flick stays
fail-closed.
"""

import pytest
from pydantic import ValidationError

from app.config import ConfigProvider, Settings, deployment_flick
from app.config.adapters import dotenv as dotenv_module
from app.config.adapters.dotenv import DotEnvAdapter
from app.config.provider import DevConfig
from app.config.settings import (
    AI_DETECTION_THRESHOLD_DEFAULT,
    CHUNK_TOKEN_LIMIT_DEFAULT,
    CHUNK_TOKEN_OVERLAP_DEFAULT,
    FLARE_MODEL_DIR,
    FLARE_MODEL_REPO,
    FLARE_MODEL_REVISION,
    INFERENCE_BATCH_SIZE_DEFAULT,
    MAX_CONCURRENT_BATCHES_DEFAULT,
    MAX_INFLIGHT_REQUESTS_DEFAULT,
    MAX_TEXT_CHARS_DEFAULT,
    MODEL_KEYS,
    MODEL_MAX_SEQUENCE_LENGTH_DEFAULT,
    SPARK_MODEL_DIR,
    SPARK_MODEL_REPO,
    SPARK_MODEL_REVISION,
)


class StubProvider(ConfigProvider):
    """Stands in for a plane in the composed chain: a plain dict lookup."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)


def test_provider_values_win_over_a_poisoned_process_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_KEY", "a" * 20)

    settings = Settings.from_provider(StubProvider({"API_KEY": "b" * 20}))

    assert settings.api_key == "b" * 20


def test_a_dev_plane_off_the_process_env_fills_the_required_key(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The fileless container shape: the dotenv default is absent, composition
    # injected the values as env vars, and they flow provider -> Settings.
    monkeypatch.delenv(dotenv_module.DOTENV_PATH_VAR, raising=False)
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", tmp_path / "absent" / ".env")
    monkeypatch.setenv("API_KEY", "a" * 20)

    settings = Settings.from_provider(DevConfig(DotEnvAdapter()))

    assert settings.api_key == "a" * 20


def test_an_unseeded_required_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({}))


def test_a_short_required_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({"API_KEY": "short"}))


# Server knobs: fail-closed like document-parser's bounds — garbage and
# non-positive values land on the default, the boot lives.
_SERVER_KNOBS: dict[str, object] = {
    "grpc_port": 50051,
    "log_level": "INFO",
    "max_text_chars": MAX_TEXT_CHARS_DEFAULT,
    "chunk_token_limit": CHUNK_TOKEN_LIMIT_DEFAULT,
    "chunk_token_overlap": CHUNK_TOKEN_OVERLAP_DEFAULT,
    "inference_batch_size": INFERENCE_BATCH_SIZE_DEFAULT,
    "max_concurrent_batches": MAX_CONCURRENT_BATCHES_DEFAULT,
    "max_inflight_requests": MAX_INFLIGHT_REQUESTS_DEFAULT,
    "ai_detection_threshold": AI_DETECTION_THRESHOLD_DEFAULT,
}


def test_the_server_knobs_hold_their_defaults_without_seeds() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    for field, default in _SERVER_KNOBS.items():
        assert getattr(settings, field) == default

def test_the_server_knobs_read_plain_seeds_from_the_string_plane() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "GRPC_PORT": "50052",
            "LOG_LEVEL": "debug",
            "MAX_TEXT_CHARS": "2000000",
            "CHUNK_TOKEN_LIMIT": "256",
            "CHUNK_TOKEN_OVERLAP": "64",
            "INFERENCE_BATCH_SIZE": "16",
            "AI_DETECTION_THRESHOLD": "0.75",
        })
    )

    assert settings.grpc_port == 50052
    assert settings.log_level == "DEBUG"
    assert settings.max_text_chars == 2_000_000
    assert settings.chunk_token_limit == 256
    assert settings.chunk_token_overlap == 64
    assert settings.inference_batch_size == 16
    assert settings.ai_detection_threshold == 0.75


@pytest.mark.parametrize(
    ("field", "seeded"),
    [
        ("grpc_port", "not a number"),
        ("grpc_port", "-1"),
        ("grpc_port", "0"),
        ("grpc_port", "1.5"),
        ("log_level", "bogus"),
        ("log_level", " "),
        ("max_text_chars", "not a number"),
        ("max_text_chars", "-1"),
        ("max_text_chars", "0"),
        ("max_text_chars", "1.5"),
        ("chunk_token_limit", "not a number"),
        ("chunk_token_limit", "-1"),
        ("chunk_token_limit", "0"),
        ("chunk_token_limit", "1.5"),
        ("chunk_token_overlap", "not a number"),
        ("chunk_token_overlap", "-1"),
        ("chunk_token_overlap", "1.5"),
        ("inference_batch_size", "not a number"),
        ("inference_batch_size", "-1"),
        ("inference_batch_size", "0"),
        ("inference_batch_size", "1.5"),
        ("max_concurrent_batches", "not a number"),
        ("max_concurrent_batches", "-1"),
        ("max_concurrent_batches", "0"),
        ("max_concurrent_batches", "1.5"),
        ("max_inflight_requests", "not a number"),
        ("max_inflight_requests", "-1"),
        ("max_inflight_requests", "0"),
        ("max_inflight_requests", "1.5"),
        ("ai_detection_threshold", "not a number"),
        ("ai_detection_threshold", "-0.1"),
        ("ai_detection_threshold", "1.5"),
        ("ai_detection_threshold", "nan"),
        ("ai_detection_threshold", "inf"),
    ],
)
def test_an_invalid_server_knob_falls_back_to_its_safe_default(field: str, seeded: str) -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20, field.upper(): seeded}))

    assert getattr(settings, field) == _SERVER_KNOBS[field]


def test_the_threshold_endpoints_are_legal_seeds() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "AI_DETECTION_THRESHOLD": "0"})
    )

    assert settings.ai_detection_threshold == 0.0


# The batch knobs: the global width, a per-model override, and the rule that
# resolves them. An unset override inherits the global width.


def test_the_per_model_batch_overrides_are_unset_without_seeds() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.flare_batch_size is None
    assert settings.spark_batch_size is None


def test_a_per_model_override_wins_over_the_global_width() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "INFERENCE_BATCH_SIZE": "16",
            "FLARE_BATCH_SIZE": "32",
        })
    )

    assert settings.batch_size_for("flare") == 32
    assert settings.batch_size_for("spark") == 16


@pytest.mark.parametrize("seeded", ["", "not a number", "-1", "0", "1.5"])
def test_an_unusable_per_model_override_falls_back_to_the_global_width(seeded: str) -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "INFERENCE_BATCH_SIZE": "16",
            "FLARE_BATCH_SIZE": seeded,
        })
    )

    assert settings.flare_batch_size is None
    assert settings.batch_size_for("flare") == 16


def test_an_unknown_model_resolves_to_the_global_width() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.batch_size_for("unknown") == INFERENCE_BATCH_SIZE_DEFAULT


# The sequence ceilings: one per model, configured rather than guessed out of
# an artifact that may not declare one.

def test_the_per_model_sequence_ceilings_hold_their_defaults() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.flare_max_sequence_length == MODEL_MAX_SEQUENCE_LENGTH_DEFAULT
    assert settings.spark_max_sequence_length == MODEL_MAX_SEQUENCE_LENGTH_DEFAULT


def test_a_seeded_sequence_ceiling_is_read_from_the_string_plane() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "SPARK_MAX_SEQUENCE_LENGTH": "256"})
    )

    assert settings.spark_max_sequence_length == 256
    assert settings.flare_max_sequence_length == MODEL_MAX_SEQUENCE_LENGTH_DEFAULT


@pytest.mark.parametrize("seeded", ["not a number", "-1", "0", "1.5"])
def test_an_invalid_sequence_ceiling_falls_back_to_its_default(seeded: str) -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "FLARE_MAX_SEQUENCE_LENGTH": seeded})
    )

    assert settings.flare_max_sequence_length == MODEL_MAX_SEQUENCE_LENGTH_DEFAULT


def test_the_ceilings_are_published_per_model_key() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.max_sequence_lengths() == {
        "flare": MODEL_MAX_SEQUENCE_LENGTH_DEFAULT,
        "spark": MODEL_MAX_SEQUENCE_LENGTH_DEFAULT,
    }


def test_every_model_key_carries_its_own_settings() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    contracts = settings.model_settings_all()

    assert [model.key for model in contracts] == list(MODEL_KEYS)
    for model in contracts:
        assert model.repo == getattr(settings, f"{model.key}_model_repo")
        assert model.revision == getattr(settings, f"{model.key}_model_revision")
        assert model.artifact_dir == getattr(settings, f"{model.key}_model_dir")
        assert model.max_sequence_length == getattr(
            settings, f"{model.key}_max_sequence_length"
        )


def test_an_unknown_model_key_has_no_settings() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    with pytest.raises(KeyError):
        settings.model_settings("unknown")


# The served set: which models this process pulls, loads and answers for.

def test_the_served_set_holds_its_default() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.enabled_models == ("spark",)


def test_a_csv_served_set_splits_trims_and_dedupes() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "ENABLED_MODELS": " flare , spark , flare , "})
    )

    assert settings.enabled_models == ("flare", "spark")


def test_the_served_set_comes_out_in_the_canonical_order() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "ENABLED_MODELS": "spark,flare"})
    )

    assert settings.enabled_models == ("flare", "spark")


@pytest.mark.parametrize("seeded", ["", "  ", "unknown", "flare,unknown", "flare,bogus"])
def test_an_unusable_served_set_fails_the_boot(seeded: str) -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({"API_KEY": "a" * 20, "ENABLED_MODELS": seeded})
        )


def test_a_zero_overlap_is_a_legal_seed() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "CHUNK_TOKEN_OVERLAP": "0"})
    )

    assert settings.chunk_token_overlap == 0


@pytest.mark.parametrize("seeded", ["512", "1919"])
def test_an_overlap_no_window_could_honour_fails_the_boot(seeded: str) -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({"API_KEY": "a" * 20, "CHUNK_TOKEN_OVERLAP": seeded})
        )


def test_the_overlap_is_bounded_by_the_chunk_limit() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({
                "API_KEY": "a" * 20,
                "CHUNK_TOKEN_LIMIT": "256",
                "CHUNK_TOKEN_OVERLAP": "300",
            })
        )


# The pull knobs: the pinned revisions are the reviewed artifact contract.
_MODEL_KNOB_DEFAULTS: dict[str, str] = {
    "model_cache_dir": "./models",
    "flare_model_repo": FLARE_MODEL_REPO,
    "flare_model_revision": FLARE_MODEL_REVISION,
    "flare_model_dir": FLARE_MODEL_DIR,
    "spark_model_repo": SPARK_MODEL_REPO,
    "spark_model_revision": SPARK_MODEL_REVISION,
    "spark_model_dir": SPARK_MODEL_DIR,
}


def test_the_model_knobs_hold_their_pinned_defaults() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    for field, default in _MODEL_KNOB_DEFAULTS.items():
        assert getattr(settings, field) == default


def test_the_model_knobs_coerce_the_string_plane() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "MODEL_CACHE_DIR": "/var/cache/inference-models"})
    )

    assert settings.model_cache_dir == "/var/cache/inference-models"


def test_a_replacement_revision_pins_through_the_string_plane() -> None:
    replacement = "f" * 40

    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "SPARK_MODEL_REVISION": replacement})
    )

    assert settings.spark_model_revision == replacement


@pytest.mark.parametrize(
    "seeded", ["", "short", "F" * 40, "g" * 40, "f" * 39, "f" * 41]
)
def test_a_malformed_revision_fails_the_boot(seeded: str) -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({"API_KEY": "a" * 20, "FLARE_MODEL_REVISION": seeded}))


def test_a_blank_hf_token_is_an_unset_one() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20, "HF_TOKEN": "   "}))

    assert settings.hf_token is None


def test_a_seeded_hf_token_is_trimmed() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20, "HF_TOKEN": " hf_token_value "}))

    assert settings.hf_token == "hf_token_value"


def test_undeclared_plane_keys_ride_and_drop() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "WORKER_THREADS": "4",
            "ENV_TYPE": "prod",  # the flick stays off the model
        })
    )

    assert settings.api_key == "a" * 20
    assert not hasattr(settings, "env_type")
    assert not hasattr(settings, "worker_threads")


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


# The load knobs: providers fail closed on unknown or empty seeds, threads
# fail open to ONNX Runtime's own default.


def test_the_load_knobs_hold_their_defaults() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.inference_providers == ("CPUExecutionProvider",)
    assert settings.ort_intra_op_threads == 0


def test_a_csv_provider_seed_splits_trims_and_dedupes_in_order() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "INFERENCE_PROVIDERS": " CUDAExecutionProvider , CPUExecutionProvider , CUDAExecutionProvider , ",
        })
    )

    assert settings.inference_providers == ("CUDAExecutionProvider", "CPUExecutionProvider")


def test_an_unknown_provider_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({"API_KEY": "a" * 20, "INFERENCE_PROVIDERS": "CudaExecutionProvider"})
        )


def test_a_blank_provider_seed_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(StubProvider({"API_KEY": "a" * 20, "INFERENCE_PROVIDERS": " , "}))


@pytest.mark.parametrize("seeded", ["not a number", "-1", "0", "1.5"])
def test_an_invalid_thread_budget_falls_back_to_the_runtime_default(seeded: str) -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "ORT_INTRA_OP_THREADS": seeded})
    )

    assert settings.ort_intra_op_threads == 0


def test_a_seeded_thread_budget_passes_through() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "ORT_INTRA_OP_THREADS": "2"})
    )

    assert settings.ort_intra_op_threads == 2


# The observability gate: the flipped pair (endpoint + ingest license key) or
# the legitimate disabled boot — never a half-configured push.


def test_an_endpoint_without_a_license_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({
                "API_KEY": "a" * 20,
                "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
            })
        )


def test_an_endpoint_with_a_short_license_key_fails_the_boot() -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({
                "API_KEY": "a" * 20,
                "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
                "NEW_RELIC_LICENSE_KEY": "d" * 8,  # the floor is 16
            })
        )


def test_an_endpoint_with_a_key_over_the_floor_passes() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318",
            "NEW_RELIC_LICENSE_KEY": "d" * 16,
        })
    )

    assert settings.otel_exporter_otlp_endpoint == "http://localhost:4318"
    assert settings.new_relic_license_key == "d" * 16


def test_the_endpoint_planes_trim_their_whitespace() -> None:
    settings = Settings.from_provider(
        StubProvider({
            "API_KEY": "a" * 20,
            "OTEL_EXPORTER_OTLP_ENDPOINT": " http://localhost:4318 ",
            "NEW_RELIC_LICENSE_KEY": "d" * 16,
        })
    )

    assert settings.otel_exporter_otlp_endpoint == "http://localhost:4318"


def test_a_blank_endpoint_is_a_legitimate_disabled_boot() -> None:
    # a blank line in a plane file is an unset one: the gate normalizes it
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "OTEL_EXPORTER_OTLP_ENDPOINT": " "})
    )

    assert settings.otel_exporter_otlp_endpoint is None
    assert settings.new_relic_license_key is None


def test_an_unset_endpoint_needs_no_license_key() -> None:
    settings = Settings.from_provider(StubProvider({"API_KEY": "a" * 20}))

    assert settings.otel_exporter_otlp_endpoint is None
    assert settings.new_relic_license_key is None


@pytest.mark.parametrize("seeded", ["0", "-0.5", "1.5", "2", "not a ratio"])
def test_a_sample_ratio_outside_its_unit_interval_fails_the_boot(seeded: str) -> None:
    with pytest.raises(ValidationError):
        Settings.from_provider(
            StubProvider({"API_KEY": "a" * 20, "OTEL_TRACE_SAMPLE_RATIO": seeded})
        )


def test_the_sample_ratio_dials_a_partial_push() -> None:
    settings = Settings.from_provider(
        StubProvider({"API_KEY": "a" * 20, "OTEL_TRACE_SAMPLE_RATIO": "0.25"})
    )

    assert settings.otel_trace_sample_ratio == 0.25
