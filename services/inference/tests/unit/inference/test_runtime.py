"""The per-model runtime: the bundle a model_id resolves to, and its two pools."""

from dataclasses import FrozenInstanceError

import pytest

from app.inference.engine import OnnxEngine
from app.inference.preprocessing import DocumentPreprocessor, FastTokenizer
from app.inference.runtime import ModelRuntime, build_runtime


class StubTokenizer:
    """Stands in for the HF tokenizer: the attributes and the one call the adapter makes."""

    cls_token_id = 50281
    sep_token_id = 50282
    pad_token_id = 50283

    def num_special_tokens_to_add(self, pair: bool = False) -> int:
        return 2


def _runtime() -> ModelRuntime:
    tokenizer = FastTokenizer(StubTokenizer())
    preprocessor = DocumentPreprocessor(
        tokenizer=tokenizer,
        chunk_token_limit=512,
        model_max_sequence_length=8192,
        max_text_chars=1_000_000,
    )
    engine = OnnxEngine(
        session=object(),
        pad_token_id=tokenizer.pad_token_id,
        max_sequence_length=8192,
        batch_size=8,
    )
    return build_runtime(
        key="spark",
        preprocessor=preprocessor,
        engine=engine,
        batch_size=8,
    )


def test_the_bundle_carries_the_preprocessor_the_engine_and_the_width() -> None:
    runtime = _runtime()

    assert runtime.key == "spark"
    assert runtime.batch_size == 8
    assert isinstance(runtime.preprocessor, DocumentPreprocessor)
    assert isinstance(runtime.engine, OnnxEngine)


def test_the_two_pools_are_distinct_objects() -> None:
    runtime = _runtime()

    assert runtime.preparation_executor is not runtime.engine_executor


def test_a_runtime_is_frozen_pure_data() -> None:
    runtime = _runtime()

    with pytest.raises(FrozenInstanceError):
        runtime.key = "flare"  # type: ignore[misc]


def test_closing_a_runtime_shuts_both_pools() -> None:
    runtime = _runtime()

    runtime.close()

    with pytest.raises(RuntimeError):
        runtime.engine_executor.submit(lambda: None)
    with pytest.raises(RuntimeError):
        runtime.preparation_executor.submit(lambda: None)
