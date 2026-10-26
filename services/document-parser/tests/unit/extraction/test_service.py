"""The extraction composition: one strategy per sniffed MIME, keys that
match the gate verbatim, the seam held abstract, and the pipeline
mechanics — deadline, cleaning, cap — driven by fakes."""

import pytest

from app.extraction import (
    BudgetExhaustedError,
    Deadline,
    ExtractionResult,
    RawLines,
    UnreadableDocumentError,
    build_default_extraction_service,
)
from app.extraction.service import DocumentExtractionService
from app.extraction.strategies import (
    DocumentExtractionStrategy,
    DocxExtractionStrategy,
    PdfExtractionStrategy,
    TextExtractionStrategy,
)
from app.validation import build_default_service
from tests.support.documents import minimal_docx_bytes, minimal_pdf_bytes

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_the_factory_registers_one_strategy_per_sniffed_mime() -> None:
    strategies = build_default_extraction_service().strategies

    assert [type(strategy) for strategy in strategies.values()] == [
        PdfExtractionStrategy,
        DocxExtractionStrategy,
        TextExtractionStrategy,
    ]


def test_the_registry_keys_exactly_what_the_gate_sniffs() -> None:
    # The gate's sniffed MIME is the registry key (extraction.md); real
    # documents prove the spine verbatim, the empty body included.
    gate = build_default_service()
    extraction_service = build_default_extraction_service()

    for body in (minimal_pdf_bytes(1), minimal_docx_bytes(), b"body\n", b""):
        outcome = gate.validate(body)

        assert outcome.mime in extraction_service.strategies


def test_the_strategy_contract_cannot_be_skipped() -> None:
    # The contract is enforced at construction; routing through a plain
    # type keeps that check runtime-only (an abstract class cannot be
    # constructed directly).
    contract: type = DocumentExtractionStrategy
    with pytest.raises(TypeError):
        contract()


def test_an_unknown_mime_rejects_as_unreadable_content() -> None:
    service = DocumentExtractionService(
        {"text/plain": YieldingStrategy([])},
        processing_budget_seconds=10.0,
        output_char_limit=1_000_000,
    )

    with pytest.raises(UnreadableDocumentError, match="application/pdf"):
        service.extract(b"body", "application/pdf")


def test_the_pipeline_runs_format_then_cleaning_then_cap() -> None:
    service = DocumentExtractionService(
        {"text/plain": YieldingStrategy(["Page 2 of 3", "hello  world", ""])},
        processing_budget_seconds=10.0,
        output_char_limit=1_000_000,
    )

    result = service.extract(b"body", "text/plain")

    assert result == ExtractionResult(text="hello world", truncated=False)


def test_an_empty_pipeline_result_is_a_clean_empty_success() -> None:
    service = DocumentExtractionService(
        {"text/plain": YieldingStrategy([])},
        processing_budget_seconds=10.0,
        output_char_limit=1_000_000,
    )

    assert service.extract(b"", "text/plain") == ExtractionResult(text="", truncated=False)


@pytest.mark.parametrize(
    ("limit", "expect_text", "expect_truncated"),
    [
        (5, "abcde", True),
        (6, "abcdef", False),
    ],
)
def test_the_cap_flags_the_first_char_beyond(
    limit: int, expect_text: str, expect_truncated: bool
) -> None:
    service = DocumentExtractionService(
        {"text/plain": YieldingStrategy(["abcdef"])},
        processing_budget_seconds=10.0,
        output_char_limit=limit,
    )

    result = service.extract(b"body", "text/plain")

    assert result == ExtractionResult(text=expect_text, truncated=expect_truncated)


def test_a_spent_budget_abandons_as_exhausted() -> None:
    # from_budget(0.0) expires the moment the fake looks at it: the spin
    # exits at its first check and the raise is the pipeline's shaped 504.
    service = DocumentExtractionService(
        {"text/plain": BusyUntilExpiredStrategy()},
        processing_budget_seconds=0.0,
        output_char_limit=1_000_000,
    )

    with pytest.raises(BudgetExhaustedError):
        service.extract(b"body", "text/plain")


class YieldingStrategy(DocumentExtractionStrategy):
    """Returns the raw lines it was built with, feeding the pipeline's
    back half."""

    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        return RawLines(self._lines, partial=False)


class BusyUntilExpiredStrategy(DocumentExtractionStrategy):
    """Spins on the deadline, then abandons; proves the budget travels."""

    def extract(self, data: bytes, deadline: Deadline) -> list[str]:
        while not deadline.expired():
            pass
        raise BudgetExhaustedError("the budget was spent between steps")
