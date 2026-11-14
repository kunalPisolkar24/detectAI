"""The load plane: a sorted fail-fast walk builds every pair offline; typed failures name the key."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models import ModelLoadError, OnnxModelLoader
from app.models.loading import onnx


def _artifact(
    root: Path, key: str, config: dict[str, Any] | None = None
) -> Path:
    """A pulled artifact dir: the loader reads the tokenizer config from it."""
    path = root / key / "onnx" / "fp32"
    path.mkdir(parents=True, exist_ok=True)
    (path / "tokenizer_config.json").write_text(
        json.dumps(config if config is not None else {"max_length": 512}),
        encoding="utf-8",
    )
    return path


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
    providers: tuple[str, ...] = ("CPUExecutionProvider",),
    ceilings: dict[str, int] | None = None,
    intra_op_threads: int = 0,
) -> OnnxModelLoader:
    return OnnxModelLoader(
        providers=providers,
        ceilings=ceilings if ceilings is not None else {"flare": 512, "spark": 512},
        intra_op_threads=intra_op_threads,
    )


def test_every_pulled_model_resolves_to_a_runtime_pair(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    loader = _loader()
    flare = _artifact(tmp_path, "flare")
    spark = _artifact(tmp_path, "spark")

    loaded = loader.load_all({"spark": spark, "flare": flare})

    assert list(loaded) == ["flare", "spark"]
    assert loaded["flare"].key == "flare"
    assert loaded["flare"].tokenizer == f"tokenizer:{flare}"
    assert loaded["flare"].session.get_providers() == ["CPUExecutionProvider"]
    assert loaded["spark"].tokenizer == f"tokenizer:{spark}"
    assert [entry["model_path"] for entry in recorder["sessions"]] == [
        str(flare / "model.onnx"),
        str(spark / "model.onnx"),
    ]


def test_the_tokenizer_loads_strictly_offline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare")

    _loader().load_all({"flare": flare})

    assert recorder["tokenizers"] == [{"path": str(flare), "local_files_only": True}]


def test_the_providers_reach_the_session_as_a_list(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, effective=["CUDAExecutionProvider", "CPUExecutionProvider"])
    flare = _artifact(tmp_path, "flare")
    requested = ("CUDAExecutionProvider", "CPUExecutionProvider")

    _loader(providers=requested).load_all({"flare": flare})

    assert recorder["sessions"][0]["providers"] == list(requested)


def test_a_zero_thread_budget_leaves_the_runtime_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare")

    _loader().load_all({"flare": flare})

    assert recorder["options"][0].intra_op_num_threads is None


def test_a_seeded_thread_budget_reaches_fresh_options_per_session(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare")
    spark = _artifact(tmp_path, "spark")

    _loader(intra_op_threads=4).load_all({"flare": flare, "spark": spark})

    assert len(recorder["options"]) == 2
    assert all(options.intra_op_num_threads == 4 for options in recorder["options"])


def test_a_session_failure_dies_typed_and_ends_the_walk(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, session_fail=str(_artifact(tmp_path, "spark") / "model.onnx"))
    loader = _loader()
    flare = _artifact(tmp_path, "flare")
    spark = _artifact(tmp_path, "spark")

    with pytest.raises(ModelLoadError) as raised:
        loader.load_all({"flare": flare, "spark": spark})

    assert "spark" in str(raised.value)
    assert isinstance(raised.value.__cause__, RuntimeError)
    assert [entry["model_path"] for entry in recorder["sessions"]] == [
        str(flare / "model.onnx")
    ]


def test_a_tokenizer_failure_dies_typed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, tokenizer_fail=str(_artifact(tmp_path, "spark")))
    flare = _artifact(tmp_path, "flare")
    spark = _artifact(tmp_path, "spark")

    with pytest.raises(ModelLoadError) as raised:
        _loader().load_all({"flare": flare, "spark": spark})

    assert "spark" in str(raised.value)
    assert isinstance(raised.value.__cause__, RuntimeError)


def test_a_provider_mismatch_fails_the_boot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, effective=["CPUExecutionProvider"])
    flare = _artifact(tmp_path, "flare")

    with pytest.raises(ModelLoadError) as raised:
        _loader(providers=("CUDAExecutionProvider",)).load_all({"flare": flare})

    assert "flare" in str(raised.value)
    assert "CUDAExecutionProvider" in str(raised.value)


def test_matching_providers_log_without_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder, effective=["CPUExecutionProvider"])
    flare = _artifact(tmp_path, "flare")

    _loader().load_all({"flare": flare})

    assert not [message for message in caplog.messages if "mismatch" in message]


def test_the_requested_provider_leading_the_session_is_accepted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # ORT keeps the requested order and appends the CPU as a fallback tail, so
    # the comparison is by what is missing, never by equality.
    recorder: dict[str, list[Any]] = {}
    _wiring(
        monkeypatch,
        recorder,
        effective=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )
    flare = _artifact(tmp_path, "flare")

    loaded = _loader(
        providers=("CUDAExecutionProvider", "CPUExecutionProvider")
    ).load_all({"flare": flare})

    assert loaded["flare"].key == "flare"


def test_the_configured_ceiling_is_the_model_s_sequence_length(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare", {"max_length": 512})

    loaded = _loader(ceilings={"flare": 512}).load_all({"flare": flare})

    assert loaded["flare"].max_sequence_length == 512


def test_the_position_ceiling_never_becomes_the_sequence_length(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # The artifact says how long the model could go, not how long it was built
    # to score: the configured ceiling is the one that counts.
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare", {"max_length": None, "model_max_length": 8192})

    loaded = _loader(ceilings={"flare": 512}).load_all({"flare": flare})

    assert loaded["flare"].max_sequence_length == 512


def test_a_ceiling_below_the_built_length_is_honoured(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare", {"max_length": 512})

    loaded = _loader(ceilings={"flare": 256}).load_all({"flare": flare})

    assert loaded["flare"].max_sequence_length == 256


def test_a_ceiling_above_the_built_length_fails_the_boot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare", {"max_length": 512})

    with pytest.raises(ModelLoadError) as raised:
        _loader(ceilings={"flare": 8192}).load_all({"flare": flare})

    assert "flare" in str(raised.value)
    assert "512" in str(raised.value)


def test_a_model_without_a_configured_ceiling_fails_the_boot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = _artifact(tmp_path, "flare")

    with pytest.raises(ModelLoadError) as raised:
        _loader(ceilings={}).load_all({"flare": flare})

    assert "flare" in str(raised.value)


def test_a_missing_tokenizer_config_dies_typed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = tmp_path / "flare" / "onnx" / "fp32"
    flare.mkdir(parents=True)

    with pytest.raises(ModelLoadError) as raised:
        _loader().load_all({"flare": flare})

    assert "flare" in str(raised.value)


def test_a_malformed_tokenizer_config_dies_typed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    recorder: dict[str, list[Any]] = {}
    _wiring(monkeypatch, recorder)
    flare = tmp_path / "flare" / "onnx" / "fp32"
    flare.mkdir(parents=True)
    (flare / "tokenizer_config.json").write_text("{not json", encoding="utf-8")

    with pytest.raises(ModelLoadError) as raised:
        _loader().load_all({"flare": flare})

    assert "flare" in str(raised.value)
