"""The results of a prepared submission: frozen pure data, and the count the model sees."""

from dataclasses import FrozenInstanceError

import pytest

from app.inference.preprocessing import Chunk, PreparedDocument


def _chunk() -> Chunk:
    return Chunk(index=0, token_ids=(50281, 42, 50282), char_start=0, char_end=6)


def test_a_chunk_is_frozen_pure_data() -> None:
    chunk = _chunk()

    assert chunk.index == 0
    assert chunk.char_start == 0
    assert chunk.char_end == 6
    with pytest.raises(FrozenInstanceError):
        chunk.index = 1  # type: ignore[misc]


def test_a_chunk_counts_the_sequence_the_model_sees() -> None:
    assert _chunk().token_count == 3


def test_a_prepared_document_is_frozen_pure_data() -> None:
    chunk = _chunk()
    document = PreparedDocument(total_chars=6, total_tokens=3, chunks=(chunk,))

    assert document.total_chars == 6
    assert document.total_tokens == 3
    assert document.chunks == (chunk,)
    with pytest.raises(FrozenInstanceError):
        document.total_chars = 7  # type: ignore[misc]
