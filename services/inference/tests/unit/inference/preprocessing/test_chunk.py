"""The results of a prepared submission: frozen pure data, and the count the model sees."""

from dataclasses import FrozenInstanceError

import pytest

from app.inference.preprocessing import Chunk, PreparedDocument


def _chunk() -> Chunk:
    return Chunk(
        index=0,
        token_ids=(50281, 42, 50282),
        context_tokens=0,
        scored_tokens=1,
        char_start=0,
        char_end=6,
    )


def test_a_chunk_is_frozen_pure_data() -> None:
    chunk = _chunk()

    assert chunk.index == 0
    assert chunk.char_start == 0
    assert chunk.char_end == 6
    with pytest.raises(FrozenInstanceError):
        chunk.index = 1  # type: ignore[misc]


def test_a_chunk_counts_the_sequence_the_model_sees() -> None:
    assert _chunk().token_count == 3


def test_a_chunk_says_how_much_of_its_input_is_context() -> None:
    chunk = Chunk(
        index=1,
        token_ids=(50281, 7, 8, 42, 50282),
        context_tokens=2,
        scored_tokens=1,
        char_start=6,
        char_end=12,
    )

    assert chunk.context_tokens == 2


def test_a_chunk_says_how_many_tokens_it_scored() -> None:
    assert _chunk().scored_tokens == 1


def test_the_scored_tokens_exclude_the_context_and_the_specials() -> None:
    chunk = Chunk(
        index=1,
        token_ids=(50281, 7, 8, 42, 50282),
        context_tokens=2,
        scored_tokens=1,
        char_start=6,
        char_end=12,
    )

    assert chunk.scored_tokens == chunk.token_count - chunk.context_tokens - 2


def test_a_prepared_document_is_frozen_pure_data() -> None:
    chunk = _chunk()
    document = PreparedDocument(total_chars=6, total_tokens=3, chunks=(chunk,))

    assert document.total_chars == 6
    assert document.total_tokens == 3
    assert document.chunks == (chunk,)
    with pytest.raises(FrozenInstanceError):
        document.total_chars = 7  # type: ignore[misc]
