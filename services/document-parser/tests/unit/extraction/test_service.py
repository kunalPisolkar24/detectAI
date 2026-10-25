"""The extraction composition: one strategy per sniffed MIME, keys that
match the gate verbatim, and the seam held abstract."""

import pytest

from app.extraction import build_default_extraction_service
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
