"""The preparation facade: admission, the window clamp, the overlap, and the cut."""

import itertools

import pytest

from app.inference.preprocessing import (
    DocumentPreprocessor,
    Encoding,
    InvalidDocument,
    PreprocessingError,
)


class StubTokenizer:
    """Satisfies the Tokenizer port: the four attributes preparation reads."""

    cls_token_id = 50281
    sep_token_id = 50282
    pad_token_id = 50283
    special_token_count = 2

    def __init__(self) -> None:
        self.seen: list[str] = []

    def encode(self, text: str) -> Encoding:
        self.seen.append(text)
        return _encoding(text.split(" "))


def _encoding(words: list[str]) -> Encoding:
    """A contiguous encoding: one token per word, the space before a word inside its span."""
    offsets: list[tuple[int, int]] = []
    ids: list[int] = []
    cursor = 0
    for index, word in enumerate(words):
        end = cursor + len(word) + (1 if index else 0)
        offsets.append((cursor, end))
        ids.append(1000 + index)
        cursor = end
    return Encoding(ids=tuple(ids), offsets=tuple(offsets))


def _preprocessor(**overrides: object) -> DocumentPreprocessor:
    kwargs: dict[str, object] = {
        "tokenizer": StubTokenizer(),
        "chunk_token_limit": 512,
        "model_max_sequence_length": 8192,
        "max_text_chars": 1_000_000,
    }
    kwargs.update(overrides)
    return DocumentPreprocessor(**kwargs)  # type: ignore[arg-type]


def _words(count: int, sentence_every: int = 0) -> list[str]:
    """Words, every nth one ending a sentence."""
    return [
        f"word{index}."
        if sentence_every and (index + 1) % sentence_every == 0
        else f"word{index}"
        for index in range(count)
    ]


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


@pytest.mark.parametrize(
    ("chunk_token_limit", "model_max_sequence_length", "expected"),
    [
        (512, 8192, 512),
        (4096, 8192, 4096),
        (4096, 512, 512),
    ],
)
def test_the_window_is_readable_from_the_outside(
    chunk_token_limit: int,
    model_max_sequence_length: int,
    expected: int,
) -> None:
    preprocessor = _preprocessor(
        chunk_token_limit=chunk_token_limit,
        model_max_sequence_length=model_max_sequence_length,
    )

    assert preprocessor.window_tokens == expected


def test_a_window_below_the_floor_is_refused() -> None:
    with pytest.raises(ValueError):
        _preprocessor(chunk_token_limit=8, model_max_sequence_length=8192)


def test_a_ceiling_below_the_floor_is_refused() -> None:
    with pytest.raises(ValueError):
        _preprocessor(chunk_token_limit=512, model_max_sequence_length=32)


def test_a_window_with_no_room_for_content_is_refused() -> None:
    class GreedyTokenizer(StubTokenizer):
        special_token_count = 64

    with pytest.raises(ValueError):
        _preprocessor(tokenizer=GreedyTokenizer(), chunk_token_limit=64)


def test_the_content_window_shrinks_by_the_overlap() -> None:
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=10)

    assert preprocessor._window_tokens == 64
    assert preprocessor._content_tokens == 64 - 2 - 10


def test_the_largest_usable_overlap_is_accepted() -> None:
    preprocessor = _preprocessor(chunk_token_limit=512, chunk_token_overlap=509)

    assert preprocessor._content_tokens == 1


def test_an_overlap_that_leaves_no_content_room_is_refused() -> None:
    with pytest.raises(ValueError, match="leaves no room for content"):
        _preprocessor(chunk_token_limit=512, chunk_token_overlap=510)


def test_the_refused_overlap_names_its_numbers() -> None:
    with pytest.raises(ValueError, match="at most 509 is usable"):
        _preprocessor(chunk_token_limit=512, chunk_token_overlap=510)


def test_invalid_document_joins_the_preprocessing_tree() -> None:
    assert issubclass(InvalidDocument, PreprocessingError)


def test_prepare_admits_tokenizes_and_windows_once() -> None:
    tokenizer = StubTokenizer()
    preprocessor = _preprocessor(tokenizer=tokenizer)
    text = "One two three."

    document = preprocessor.prepare(text)

    assert tokenizer.seen == [text]
    assert document.total_chars == len(text)
    assert document.total_tokens == 3
    assert len(document.chunks) == 1
    assert document.chunks[0].token_ids == (50281, 1000, 1001, 1002, 50282)


def test_split_windows_an_already_encoded_document() -> None:
    words = _words(100)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    assert [chunk.index for chunk in chunks] == [0, 1]


@pytest.mark.parametrize("text", ["", "   \n  ", "\x00", "\x01\x02", " \x00 "])
def test_a_blank_submission_is_refused(text: str) -> None:
    with pytest.raises(InvalidDocument):
        _preprocessor().prepare(text)


def test_a_non_string_submission_is_refused() -> None:
    with pytest.raises(InvalidDocument):
        _preprocessor().prepare(None)  # type: ignore[arg-type]


def test_an_oversized_submission_is_refused_before_any_tokenization() -> None:
    tokenizer = StubTokenizer()
    preprocessor = _preprocessor(tokenizer=tokenizer, max_text_chars=10)

    with pytest.raises(InvalidDocument):
        preprocessor.prepare("x" * 11)

    assert tokenizer.seen == []


def test_the_text_reaches_the_tokenizer_unmodified() -> None:
    tokenizer = StubTokenizer()
    preprocessor = _preprocessor(tokenizer=tokenizer)

    preprocessor.prepare("  Hello world.  ")

    assert tokenizer.seen == ["  Hello world.  "]


def test_the_special_tokens_bracket_the_content_exactly_once() -> None:
    words = _words(100)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    assert chunks[0].token_ids[0] == 50281
    assert chunks[0].token_ids[-1] == 50282
    assert chunks[0].token_ids[1:-1] == encoding.ids[: chunks[0].token_count - 2]


def test_no_chunk_exceeds_the_window() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    assert all(chunk.token_count <= 64 for chunk in chunks)


def test_the_chunks_tile_the_text_without_gaps_or_overlaps() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    for previous, following in itertools.pairwise(chunks):
        assert previous.char_end == following.char_start


def test_a_cut_is_taken_at_the_last_boundary_in_the_upper_half() -> None:
    words = _words(100, sentence_every=10)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    # the window holds 62 content tokens; the last boundary inside it follows token 59
    assert chunks[0].token_count == 62
    assert chunks[1].char_start == chunks[0].char_end


def test_a_document_without_boundaries_is_cut_hard() -> None:
    words = _words(100)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    assert chunks[0].token_count == 64
    assert chunks[1].token_count == 40


def test_short_sentences_do_not_produce_a_chunk_each() -> None:
    words = _words(100, sentence_every=1)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    # every token ends a sentence, yet the first chunk holds the whole window
    assert chunks[0].token_count == 64
    assert len(chunks) == 2


def test_a_single_chunk_document() -> None:
    words = _words(3)
    encoding = _encoding(words)

    chunks = _preprocessor(chunk_token_limit=64).split(" ".join(words), encoding)

    assert len(chunks) == 1
    assert chunks[0].token_count == 5


def test_an_empty_encoding_windows_to_nothing() -> None:
    assert _preprocessor().split("", Encoding(ids=(), offsets=())) == ()


def test_the_overlap_at_zero_is_the_finished_slices_output() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=0)

    chunks = preprocessor.split(" ".join(words), encoding)

    assert [chunk.token_count for chunk in chunks] == [62, 62, 62, 22]
    assert all(chunk.context_tokens == 0 for chunk in chunks)
    assert chunks[1].token_ids[1:-1] == encoding.ids[60:120]


def test_the_input_is_the_window_but_for_the_first_chunk() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=10)

    chunks = preprocessor.split(" ".join(words), encoding)

    assert [chunk.token_count for chunk in chunks] == [52, 62, 62, 62]
    assert all(chunk.token_count <= 64 for chunk in chunks)


def test_the_context_prefix_carries_the_preceding_content() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=10)

    chunks = preprocessor.split(" ".join(words), encoding)

    assert chunks[1].context_tokens == 10
    assert chunks[1].token_ids[1:11] == encoding.ids[40:50]
    assert chunks[1].token_ids[11:-1] == encoding.ids[50:100]


def test_the_first_chunk_has_no_context() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=10)

    chunks = preprocessor.split(" ".join(words), encoding)

    assert chunks[0].context_tokens == 0
    assert chunks[0].token_ids[1:-1] == encoding.ids[:50]


def test_the_scored_regions_still_tile_the_text_under_an_overlap() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=10)

    chunks = preprocessor.split(" ".join(words), encoding)

    for previous, following in itertools.pairwise(chunks):
        assert previous.char_end == following.char_start


def test_the_scored_regions_still_tile_the_token_stream() -> None:
    words = _words(200, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=10)

    chunks = preprocessor.split(" ".join(words), encoding)

    scored = tuple(
        token
        for chunk in chunks
        for token in chunk.token_ids[1 + chunk.context_tokens : -1]
    )
    assert scored == encoding.ids


def test_the_context_is_clamped_at_the_document_start() -> None:
    words = _words(60, sentence_every=10)
    encoding = _encoding(words)
    preprocessor = _preprocessor(chunk_token_limit=64, chunk_token_overlap=20)

    chunks = preprocessor.split(" ".join(words), encoding)

    assert chunks[0].context_tokens == 0
    assert chunks[1].context_tokens == 20
