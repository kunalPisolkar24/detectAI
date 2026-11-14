"""The boot's warmup step: every model is warmed, and one that cannot score kills the boot."""

import pytest

from app.inference.engine import EngineError
from app.inference.preprocessing import DocumentPreprocessor
from app.inference.runtime import ModelRuntime
from app.main import _warm_runtimes


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

    _warm_runtimes({"spark": _runtime(engine)})

    assert engine.lengths == [512]


def test_the_window_is_the_smaller_of_the_knob_and_the_model_ceiling() -> None:
    engine = RecordingEngine()

    _warm_runtimes({"spark": _runtime(engine, chunk_token_limit=4096)})

    assert engine.lengths == [4096]


def test_a_model_that_cannot_score_kills_the_boot() -> None:
    with pytest.raises(EngineError, match="the session run failed"):
        _warm_runtimes({"spark": _runtime(FailingEngine())})
