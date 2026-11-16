"""The boot: the plane resolves, and every model is warmed or the boot dies."""

import logging
from pathlib import Path
from types import SimpleNamespace

import pytest

from app import boot
from app.config import Settings
from app.config.provider import ConfigProvider
from app.inference.engine import EngineError, OnnxEngine
from app.inference.preprocessing import DocumentPreprocessor
from app.inference.runtime import ModelRuntime
from app.models import LoadedModel


class StubTokenizer:
    """Satisfies the Tokenizer port: the four attributes preparation reads."""

    cls_token_id = 50281
    sep_token_id = 50282
    pad_token_id = 50283
    special_token_count = 2


class RecordingEngine:
    """Records the length it was warmed at."""

    def __init__(self) -> None:
        self.lengths: list[int] = []

    def warmup(self, sequence_length: int) -> None:
        self.lengths.append(sequence_length)


class FailingEngine:
    """A model that loads but cannot score."""

    def warmup(self, sequence_length: int) -> None:
        raise EngineError("the session run failed: the graph is broken")


class StubProvider(ConfigProvider):
    """The config plane: the seeded values, read by name."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def get(self, key: str, default: str | None = None) -> str | None:
        return self._values.get(key, default)


def _runtime(engine: object, chunk_token_limit: int = 512) -> ModelRuntime:
    preprocessor = DocumentPreprocessor(
        tokenizer=StubTokenizer(),
        chunk_token_limit=chunk_token_limit,
        model_max_sequence_length=8192,
        max_text_chars=1_000_000,
    )
    return ModelRuntime(
        key="spark",
        preprocessor=preprocessor,
        engine=engine,  # type: ignore[arg-type]
        batch_size=8,
        preparation_executor=object(),  # type: ignore[arg-type]
        engine_executor=object(),  # type: ignore[arg-type]
        max_inflight=2,
    )


def test_each_model_is_warmed_at_the_production_window() -> None:
    engine = RecordingEngine()

    boot.warm_runtimes({"spark": _runtime(engine)})

    assert engine.lengths == [512]


def test_the_window_is_the_smaller_of_the_knob_and_the_model_ceiling() -> None:
    engine = RecordingEngine()

    boot.warm_runtimes({"spark": _runtime(engine, chunk_token_limit=4096)})

    assert engine.lengths == [4096]


def test_a_model_that_cannot_score_kills_the_boot() -> None:
    with pytest.raises(EngineError, match="the session run failed"):
        boot.warm_runtimes({"spark": _runtime(FailingEngine())})


def test_the_settings_come_from_the_config_plane(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV_TYPE", "dev")
    monkeypatch.setattr(
        boot,
        "ConfigFactory",
        SimpleNamespace(
            create=lambda flick: StubProvider({"API_KEY": "0123456789abcdef", "GRPC_PORT": "50051"})
        ),
    )
    root = logging.getLogger()
    original = root.level
    try:
        settings = boot.resolve_settings()
    finally:
        root.setLevel(original)

    assert settings.grpc_port == 50051
    assert settings.api_key == "0123456789abcdef"


def test_the_plane_is_prod_only_for_an_exact_prod(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENV_TYPE", "prod")
    assert boot.resolve_plane() == "prod"

    monkeypatch.setenv("ENV_TYPE", "dev")
    assert boot.resolve_plane() == "dev"

    monkeypatch.delenv("ENV_TYPE", raising=False)
    assert boot.resolve_plane() == "dev"


def _settings() -> Settings:
    return Settings.model_validate({"api_key": "a" * 20})


class _HfTokenizer:
    """The HF attributes FastTokenizer copies at construction."""

    cls_token_id = 101
    sep_token_id = 102
    pad_token_id = 0

    def num_special_tokens_to_add(self, pair: bool) -> int:
        return 2


def _loaded(key: str) -> LoadedModel:
    return LoadedModel(
        key=key,
        session=object(),
        tokenizer=_HfTokenizer(),
        max_sequence_length=512,
        providers=("CPUExecutionProvider",),
    )


def test_artifacts_are_pulled_from_the_settings_cache_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings()
    calls: list[tuple[str, object]] = []

    class Store:
        def __init__(self, root: Path, token: str | None) -> None:
            calls.append(("store", (root, token)))

    class Manager:
        def __init__(self, specs: object, store: object) -> None:
            calls.append(("manager", (specs, store)))

        def ensure_all(self) -> dict[str, Path]:
            calls.append(("ensure_all", None))
            return {"spark": Path("/cache/spark")}

    class Specs:
        def __init__(self, received: Settings) -> None:
            calls.append(("specs", received))

        @classmethod
        def from_settings(cls, received: Settings) -> "Specs":
            return cls(received)

    monkeypatch.setattr(boot, "HuggingFaceStore", Store)
    monkeypatch.setattr(boot, "ModelArtifactManager", Manager)
    monkeypatch.setattr(boot, "ModelSpecs", Specs)

    artifacts = boot.ensure_model_artifacts(settings)

    assert artifacts == {"spark": Path("/cache/spark")}
    assert calls[0] == ("store", (Path(settings.model_cache_dir), settings.hf_token))
    assert calls[1] == ("specs", settings)
    assert calls[2][0] == "manager"
    assert isinstance(calls[2][1][0], Specs)
    assert calls[-1] == ("ensure_all", None)


def test_models_are_loaded_with_the_settings_plane(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings()
    calls: list[tuple[str, object]] = []
    artifacts = {"spark": Path("/cache/spark")}

    class Loader:
        def __init__(self, providers: object, ceilings: object, intra_op_threads: int) -> None:
            calls.append(("loader", (providers, ceilings, intra_op_threads)))

        def load_all(self, received: object) -> dict[str, LoadedModel]:
            calls.append(("load_all", received))
            return {"spark": _loaded("spark")}

    monkeypatch.setattr(boot, "OnnxModelLoader", Loader)

    loaded = boot.load_models(settings, artifacts)

    assert list(loaded) == ["spark"]
    assert calls[0] == (
        "loader",
        (
            settings.inference_providers,
            settings.max_sequence_lengths(),
            settings.ort_intra_op_threads,
        ),
    )
    assert calls[-1] == ("load_all", artifacts)


def test_runtimes_are_built_in_a_stable_order_with_the_settings_knobs() -> None:
    settings = _settings()
    loaded = {"spark": _loaded("spark"), "flare": _loaded("flare")}

    runtimes = boot.build_runtimes(settings, loaded)

    assert list(runtimes) == ["flare", "spark"]
    for key, runtime in runtimes.items():
        assert runtime.key == key
        assert isinstance(runtime.engine, OnnxEngine)
        assert runtime.batch_size == settings.batch_size_for(key)
        assert runtime.max_inflight == settings.max_concurrent_batches
        assert runtime.revision == settings.model_settings(key).revision
        assert runtime.providers == loaded[key].providers
        assert runtime.preprocessor.window_tokens == 512


def test_close_walks_the_runtimes_in_a_stable_order() -> None:
    calls: list[str] = []
    runtimes = {
        key: SimpleNamespace(close=lambda key=key: calls.append(key))
        for key in ("spark", "flare")
    }

    boot.close_runtimes(runtimes)

    assert calls == ["flare", "spark"]


def test_the_plane_is_announced_after_the_log_level_lands(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv("ENV_TYPE", "dev")
    monkeypatch.setattr(
        boot,
        "ConfigFactory",
        SimpleNamespace(create=lambda flick: StubProvider({"API_KEY": "0123456789abcdef"})),
    )
    root = logging.getLogger()
    original = root.level
    try:
        with caplog.at_level(logging.INFO):
            boot.resolve_settings()
    finally:
        root.setLevel(original)

    assert "config plane: dev" in caplog.text
