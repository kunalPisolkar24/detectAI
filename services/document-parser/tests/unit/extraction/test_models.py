"""The extraction vocabulary: defaults pinned, the verdicts typed, the
deadline clocked."""

import pytest

from app.extraction import models
from app.extraction.models import (
    DEFAULT_OUTPUT_CHAR_LIMIT,
    DEFAULT_PROCESSING_BUDGET_SECONDS,
    BudgetExhaustedError,
    Deadline,
    ExtractionError,
    UnreadableDocumentError,
)


def test_the_extraction_defaults_pin_their_spec_values() -> None:
    assert DEFAULT_PROCESSING_BUDGET_SECONDS == 10.0
    assert DEFAULT_OUTPUT_CHAR_LIMIT == 1_000_000


def test_the_typed_verdicts_share_one_extraction_base() -> None:
    assert issubclass(BudgetExhaustedError, ExtractionError)
    assert issubclass(UnreadableDocumentError, ExtractionError)


def test_a_deadline_expires_when_its_budget_is_spent(monkeypatch: pytest.MonkeyPatch) -> None:
    now = 100.0
    monkeypatch.setattr(models, "perf_counter", lambda: now)
    deadline = Deadline.from_budget(10.0)

    assert not deadline.expired()
    now = 110.0
    assert deadline.expired()
