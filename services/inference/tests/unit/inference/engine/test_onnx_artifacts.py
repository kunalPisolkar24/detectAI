"""The adapter against the real artifacts: the input names, the dtype and the output shape.

The sequences are three tokens long on purpose. The point is correctness — that
the shipped graphs accept what the engine builds and answer with the shape the
engine expects — not throughput, so the test stays small on any host. The
observed probabilities are reported, never asserted.
"""

from pathlib import Path

import onnxruntime as ort
import pytest
from transformers import AutoTokenizer

from app.config.settings import Settings
from app.inference.engine import OnnxEngine
from app.models.pulling.spec import ModelSpecs

_SERVICE_ROOT = Path(__file__).resolve().parents[4]
_ARTIFACT_ROOT = _SERVICE_ROOT / "models"

_SPECS = {
    spec.key: spec
    for spec in ModelSpecs.from_settings(Settings(api_key="artifact-backed-test-key"))
}


def _artifact_dir(key: str) -> Path:
    return _ARTIFACT_ROOT / key / _SPECS[key].artifact_dir


def _engine_for(key: str) -> OnnxEngine:
    directory = _artifact_dir(key)
    tokenizer = AutoTokenizer.from_pretrained(str(directory), local_files_only=True)
    session = ort.InferenceSession(
        str(directory / "model.onnx"), providers=["CPUExecutionProvider"]
    )
    return OnnxEngine(
        session=session,
        pad_token_id=tokenizer.pad_token_id,
        max_sequence_length=512,
        batch_size=2,
    )


@pytest.mark.parametrize("key", sorted(_SPECS))
def test_the_real_session_scores_a_short_sequence(key: str) -> None:
    directory = _artifact_dir(key)
    if not (directory / "model.onnx").is_file():
        pytest.skip(f"the {key} artifact is not pulled")

    engine = _engine_for(key)

    probabilities = engine.score(((50281, 1000, 50282),))

    assert len(probabilities) == 1
    assert 0.0 <= probabilities[0] <= 1.0
    print(f"{key}: p_ai for a three-token sequence = {probabilities[0]:.6f}")
