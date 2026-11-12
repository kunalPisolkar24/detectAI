"""The load plane: a sorted fail-fast walk builds every pair offline; typed failures name the key."""

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models import ModelLoadError, OnnxModelLoader
from app.models.loading import onnx

_FLARE = Path("/models/flare/onnx/fp32")
_SPARK = Path("/models/spark/onnx/fp16")


def _wiring(
    monkeypatch: pytest.MonkeyPatch,
    recorder: dict[str, list[Any]],
    *,
    effective: list[str] | None = None,
    session_fail: str | None = None,
    tokenizer_fail: str | None = None,
) -> None:
    """Swap onnxruntime and transformers for scripted fakes at the adapter module."""

    class SessionOptions:
        def __init__(self) -> None:
            self.intra_op_num_threads: int | None = None
            recorder.setdefault("options", []).append(self)

    class InferenceSession:
        def __init__(
            self, model_path: str, sess_options: SessionOptions, providers: list[str]
        ) -> None:
            if model_path == session_fail:
                raise RuntimeError("malformed build")
            recorder.setdefault("sessions", []).append({
                "model_path": model_path,
                "sess_options": sess_options,
                "providers": providers,
            })
            self._effective = effective or ["CPUExecutionProvider"]

        def get_providers(self) -> list[str]:
            return list(self._effective)

    def from_pretrained(path: str, local_files_only: bool) -> str:
        if path == tokenizer_fail:
            raise RuntimeError("no tokenizer here")
        recorder.setdefault("tokenizers", []).append({
            "path": path,
            "local_files_only": local_files_only,
        })
        return f"tokenizer:{path}"

    monkeypatch.setattr(
        onnx, "ort", SimpleNamespace(SessionOptions=SessionOptions, InferenceSession=InferenceSession)
    )
    monkeypatch.setattr(onnx, "AutoTokenizer", SimpleNamespace(from_pretrained=from_pretrained))


def _loader(
    providers: tuple[str, ...] = ("CPUExecutionProvider",), intra_op_threads: int = 0
) -> OnnxModelLoader:
    return OnnxModelLoader(providers=providers, intra_op_threads=intra_op_threads)


def test_every_pulled_model_resolves_to_a_runtime_pair(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    loader = _loader()

    loaded = loader.load_all({"spark": _SPARK, "flare": _FLARE})

    assert list(loaded) == ["flare", "spark"]
    assert loaded["flare"].key == "flare"
    assert loaded["flare"].tokenizer == f"tokenizer:{_FLARE}"
    assert loaded["flare"].session.get_providers() == ["CPUExecutionProvider"]
    assert loaded["spark"].tokenizer == f"tokenizer:{_SPARK}"
    assert [entry["model_path"] for entry in recorder["sessions"]] == [
        str(_FLARE / "model.onnx"),
        str(_SPARK / "model.onnx"),
    ]


def test_the_tokenizer_loads_strictly_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)

    _loader().load_all({"flare": _FLARE})

    assert recorder["tokenizers"] == [{"path": str(_FLARE), "local_files_only": True}]


def test_the_providers_reach_the_session_as_a_list(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder: dict[str, list[Any]] = {}
    requested = ("CUDAExecutionProvider", "CPUExecutionProvider")
    _wiring(monkeypatch, recorder, effective=["CUDAExecutionProvider", "CPUExecutionProvider"])

    _loader(providers=requested).load_all({"flare": _FLARE})

    assert recorder["sessions"][0]["providers"] == list(requested)


def test_a_zero_thread_budget_leaves_the_runtime_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)

    _loader().load_all({"flare": _FLARE})

    assert recorder["options"][0].intra_op_num_threads is None


def test_a_seeded_thread_budget_reaches_fresh_options_per_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)

    _loader(intra_op_threads=4).load_all({"flare": _FLARE, "spark": _SPARK})

    assert len(recorder["options"]) == 2
    assert all(options.intra_op_num_threads == 4 for options in recorder["options"])


def test_a_session_failure_dies_typed_and_ends_the_walk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, session_fail=str(_SPARK / "model.onnx"))
    loader = _loader()

    with pytest.raises(ModelLoadError) as raised:
        loader.load_all({"flare": _FLARE, "spark": _SPARK})

    assert "spark" in str(raised.value)
    assert isinstance(raised.value.__cause__, RuntimeError)
    assert [entry["model_path"] for entry in recorder["sessions"]] == [
        str(_FLARE / "model.onnx")
    ]


def test_a_tokenizer_failure_dies_typed(monkeypatch: pytest.MonkeyPatch) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, tokenizer_fail=str(_SPARK))

    with pytest.raises(ModelLoadError) as raised:
        _loader().load_all({"flare": _FLARE, "spark": _SPARK})

    assert "spark" in str(raised.value)
    assert isinstance(raised.value.__cause__, RuntimeError)


def test_a_provider_mismatch_warns_and_proceeds(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, effective=["CPUExecutionProvider"])

    loaded = _loader(providers=("CUDAExecutionProvider", "CPUExecutionProvider")).load_all(
        {"flare": _FLARE}
    )

    assert list(loaded) == ["flare"]
    assert any("provider mismatch" in message for message in caplog.messages)


def test_matching_providers_log_without_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, effective=["CPUExecutionProvider"])

    _loader().load_all({"flare": _FLARE})

    assert not [message for message in caplog.messages if "mismatch" in message]
