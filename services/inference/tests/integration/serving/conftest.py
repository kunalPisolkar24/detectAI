"""The integration tier's fake model: the service's own wiring, exercised end
to end without a session or a downloaded artifact.
"""

import pytest

from app.inference.analysis import DocumentAnalysis
from app.inference.preprocessing import DocumentPreprocessor, Encoding
from app.inference.runtime import build_runtime

_SCORE = 0.9


class StubTokenizer:
    """Satisfies the Tokenizer port: the attributes and the one call preparation reads."""

    cls_token_id = 50281
    sep_token_id = 50282
    pad_token_id = 50283
    special_token_count = 2

    def encode(self, text: str) -> Encoding:
        """One token per word, the space before a word inside its span."""
        offsets: list[tuple[int, int]] = []
        ids: list[int] = []
        cursor = 0
        for index, word in enumerate(text.split()):
            end = cursor + len(word) + (1 if index else 0)
            offsets.append((cursor, end))
            ids.append(1000 + index)
            cursor = end
        return Encoding(ids=tuple(ids), offsets=tuple(offsets))


class StubEngine:
    """Scores every chunk alike, without a session."""

    def score(self, sequences: list[list[int]]) -> tuple[float, ...]:
        return tuple(_SCORE for _ in sequences)

    def warmup(self, sequence_length: int) -> None:
        return None


@pytest.fixture
def analysis() -> DocumentAnalysis:
    """The use case over a fake model: the service's own wiring, no weights."""
    preprocessor = DocumentPreprocessor(
        tokenizer=StubTokenizer(),
        chunk_token_limit=512,
        model_max_sequence_length=512,
        max_text_chars=1_000_000,
    )
    runtime = build_runtime(
        key="spark",
        preprocessor=preprocessor,
        engine=StubEngine(),
        batch_size=8,
        max_inflight=2,
    )
    return DocumentAnalysis({"spark": runtime}, threshold=0.5)
