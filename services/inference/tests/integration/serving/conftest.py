"""The integration tier's fake model: the service's own wiring, exercised end
to end without a session or a downloaded artifact.
"""

import threading

import pytest

from app.inference.analysis import DocumentAnalysis
from app.inference.preprocessing import DocumentPreprocessor, Encoding
from app.inference.runtime import build_runtime
from app.observability import NullObservability
from app.observability.contract import Observability

_SCORE = 0.9

# The pinned artifact identity the runtime carries into the span.
_REVISION = "b0ab87257cc240d66622c2482270ec726e16c553"


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


class BlockingEngine(StubEngine):
    """Holds the engine until the test releases it."""

    def __init__(self) -> None:
        self.entered = threading.Event()
        self.release = threading.Event()

    def score(self, sequences: list[list[int]]) -> tuple[float, ...]:
        self.entered.set()
        self.release.wait(timeout=10)
        return tuple(_SCORE for _ in sequences)


def build_analysis(
    engine: StubEngine,
    max_inflight: int = 2,
    observability: Observability | None = None,
    max_text_chars: int = 1_000_000,
) -> DocumentAnalysis:
    """The use case over a fake model: the service's own wiring, no weights."""
    preprocessor = DocumentPreprocessor(
        tokenizer=StubTokenizer(),
        chunk_token_limit=512,
        model_max_sequence_length=512,
        max_text_chars=max_text_chars,
    )
    runtime = build_runtime(
        key="spark",
        preprocessor=preprocessor,
        engine=engine,
        batch_size=8,
        max_inflight=max_inflight,
        revision=_REVISION,
        providers=("CPUExecutionProvider",),
    )
    return DocumentAnalysis(
        {"spark": runtime},
        threshold=0.5,
        observability=observability or NullObservability(),
    )


@pytest.fixture
def analysis() -> DocumentAnalysis:
    return build_analysis(StubEngine())
