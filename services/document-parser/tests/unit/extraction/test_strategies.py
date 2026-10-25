"""The text strategy: decode, split, and own a failure."""

import pytest

from app.extraction.models import Deadline, UnreadableDocumentError
from app.extraction.strategies import TextExtractionStrategy

_FAR_DEADLINE = Deadline.from_budget(10.0)


def test_the_text_strategy_decodes_its_body_into_lines() -> None:
    assert TextExtractionStrategy().extract(b"first\nsecond\nthird", _FAR_DEADLINE) == [
        "first",
        "second",
        "third",
    ]


def test_the_text_strategy_accepts_the_empty_body() -> None:
    assert TextExtractionStrategy().extract(b"", _FAR_DEADLINE) == []


def test_the_text_strategy_owns_a_failed_decode() -> None:
    with pytest.raises(UnreadableDocumentError):
        TextExtractionStrategy().extract(b"\xff\xfe\x00", _FAR_DEADLINE)
