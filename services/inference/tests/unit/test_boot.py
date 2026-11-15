"""The boot: the plane resolves, and every model is warmed or the boot dies."""

import logging
from types import SimpleNamespace

import pytest

from app import boot
from app.config.provider import ConfigProvider
from app.inference.engine import EngineError
from app.inference.preprocessing import DocumentPreprocessor
from app.inference.runtime import ModelRuntime


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
