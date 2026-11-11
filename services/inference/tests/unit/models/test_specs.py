"""Specs from Settings: one per model, the minimal file set, values straight from the contract."""

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.models import ModelSpec, ModelSpecs


def _settings() -> Settings:
    return Settings(api_key="a" * 20)


def test_one_spec_per_model_built_from_the_settings_contract() -> None:
    settings = _settings()
    specs = {spec.key: spec for spec in ModelSpecs.from_settings(settings)}

    assert set(specs) == {"flare", "spark"}
    assert (specs["flare"].repo, specs["flare"].revision, specs["flare"].artifact_dir) == (
        settings.flare_model_repo,
        settings.flare_model_revision,
        settings.flare_model_dir,
    )
    assert (specs["spark"].repo, specs["spark"].revision, specs["spark"].artifact_dir) == (
        settings.spark_model_repo,
        settings.spark_model_revision,
        settings.spark_model_dir,
    )


def test_the_flare_file_set_is_the_minimal_inference_set() -> None:
    flare = ModelSpecs.from_settings(_settings())[0]

    assert flare.files == (
        "onnx/fp32/model.onnx",
        "onnx/fp32/model.onnx.data",
        "onnx/fp32/tokenizer.json",
        "onnx/fp32/tokenizer_config.json",
        "onnx/fp32/special_tokens_map.json",
    )


def test_the_spark_file_set_is_the_minimal_inference_set() -> None:
    spark = ModelSpecs.from_settings(_settings())[1]

    assert spark.files == (
        "onnx/fp16/config.json",
        "onnx/fp16/model.onnx",
        "onnx/fp16/model.onnx.data",
        "onnx/fp16/tokenizer.json",
        "onnx/fp16/tokenizer_config.json",
        "onnx/fp16/special_tokens_map.json",
    )


def test_a_spec_is_frozen() -> None:
    spec = ModelSpecs.from_settings(_settings())[0]

    with pytest.raises(ValidationError):
        spec.key = "other"


def test_a_file_outside_the_artifact_dir_fails_the_spec() -> None:
    with pytest.raises(ValidationError):
        ModelSpec(
            key="x",
            repo="o/r",
            revision="a" * 40,
            artifact_dir="onnx/fp32",
            files=("onnx/fp16/model.onnx",),
        )


def test_an_empty_file_set_fails_the_spec() -> None:
    with pytest.raises(ValidationError):
        ModelSpec(key="x", repo="o/r", revision="a" * 40, artifact_dir="onnx/fp32", files=())
