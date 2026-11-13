"""The preparation facade: the window clamp is real, the admission and the cut rule are pending."""

import pytest

from app.inference.preprocessing import (
    DocumentPreprocessor,
    Encoding,
    InvalidDocument,
    PreprocessingError,
)


class StubTokenizer:
    """Satisfies the Tokenizer port: the three attributes preparation reads."""

    cls_token_id = 50281
    sep_token_id = 50282
    special_token_count = 2


def _preprocessor(**overrides: object) -> DocumentPreprocessor:
    kwargs: dict[str, object] = {
        "tokenizer": StubTokenizer(),
        "chunk_token_limit": 512,
        "model_max_sequence_length": 8192,
        "max_text_chars": 1_000_000,
    }
    kwargs.update(overrides)
    return DocumentPreprocessor(**kwargs)  # type: ignore[arg-type]


def test_a_prepare_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _preprocessor().prepare("some text")


def test_a_split_request_is_pending() -> None:
    with pytest.raises(NotImplementedError):
        _preprocessor().split("some text", Encoding(ids=(), offsets=()))


def test_the_preprocessor_holds_its_explicit_contract() -> None:
    preprocessor = _preprocessor(
        chunk_token_limit=256,
        model_max_sequence_length=8192,
        max_text_chars=10,
    )

    assert preprocessor._chunk_token_limit == 256
    assert preprocessor._model_max_sequence_length == 8192
    assert preprocessor._max_text_chars == 10


@pytest.mark.parametrize(
    ("chunk_token_limit", "model_max_sequence_length", "expected"),
    [
        (512, 8192, 512),
        (4096, 8192, 4096),
        (4096, 512, 512),
        (512, 512, 512),
    ],
)
def test_the_window_is_the_smaller_of_the_knob_and_the_model_ceiling(
    chunk_token_limit: int,
    model_max_sequence_length: int,
    expected: int,
) -> None:
    preprocessor = _preprocessor(
        chunk_token_limit=chunk_token_limit,
        model_max_sequence_length=model_max_sequence_length,
    )

    assert preprocessor._window_tokens == expected
    assert preprocessor._content_tokens == expected - 2


def test_a_window_below_the_floor_is_refused() -> None:
    with pytest.raises(ValueError):
        _preprocessor(chunk_token_limit=8, model_max_sequence_length=8192)


def test_a_ceiling_below_the_floor_is_refused() -> None:
    with pytest.raises(ValueError):
        _preprocessor(chunk_token_limit=512, model_max_sequence_length=32)


def test_invalid_document_joins_the_preprocessing_tree() -> None:
    assert issubclass(InvalidDocument, PreprocessingError)
