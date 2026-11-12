"""The load skeleton: the port, the result, and the adapter's pending contract."""

from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from app.models import ArtifactError, LoadedModel, ModelLoadError, OnnxModelLoader


def _loader(**overrides: object) -> OnnxModelLoader:
    kwargs: dict[str, object] = {
        "providers": ("CPUExecutionProvider",),
        "intra_op_threads": 4,
    }
    kwargs.update(overrides)
    return OnnxModelLoader(**kwargs)  # type: ignore[arg-type]


def test_a_load_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _loader().load_all({"flare": Path("/models/flare/onnx/fp32")})


def test_model_load_error_joins_the_artifact_tree() -> None:
    assert issubclass(ModelLoadError, ArtifactError)


def test_a_loaded_model_is_frozen_pure_data() -> None:
    loaded = LoadedModel(key="flare", session=object(), tokenizer=object())

    assert loaded.key == "flare"
    with pytest.raises(FrozenInstanceError):
        loaded.key = "spark"  # type: ignore[misc]


def test_the_adapter_holds_its_explicit_contract() -> None:
    loader = _loader(
        providers=("CUDAExecutionProvider", "CPUExecutionProvider"),
        intra_op_threads=2,
    )

    assert loader._providers == ("CUDAExecutionProvider", "CPUExecutionProvider")
    assert loader._intra_op_threads == 2


def test_the_adapter_holds_its_default_thread_budget() -> None:
    loader = OnnxModelLoader(providers=("CPUExecutionProvider",))

    assert loader._intra_op_threads == 0
