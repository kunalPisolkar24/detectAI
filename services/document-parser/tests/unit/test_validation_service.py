"""The registry contract and its orchestration, pinned end to end.

build_default_service is the production composition: PDF, DOCX, then TXT —
text last, because a decodable body would otherwise claim the
classification ahead of the magic-prefixed types. Orchestration gets its
own table: first outcome wins, a full decline names the junk, and the ABC
shape stays abstract — a strategy without a validate is not instantiable.
"""

import pytest

from app.validation import (
    DocumentValidationService,
    UnsupportedTypeError,
    ValidationOutcome,
    build_default_service,
)
from app.validation.strategies import (
    DocumentValidationStrategy,
    DocxValidationStrategy,
    PdfValidationStrategy,
    TextValidationStrategy,
)

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_default_registry_composes_the_three_types_in_contract_order() -> None:
    strategies = build_default_service().strategies

    assert [type(strategy) for strategy in strategies] == [
        PdfValidationStrategy,
        DocxValidationStrategy,
        TextValidationStrategy,
    ]


def test_a_service_runs_whatever_registry_it_is_handed() -> None:
    registry: tuple[DocumentValidationStrategy, ...] = (PdfValidationStrategy(),)

    service = DocumentValidationService(registry)

    assert service.strategies == registry


def test_the_strategy_contract_cannot_be_skipped() -> None:
    with pytest.raises(TypeError):
        DocumentValidationStrategy()


def test_the_default_registry_admits_every_supported_type() -> None:
    service = build_default_service()

    assert service.validate(b"%PDF-1.7\n body").mime == "application/pdf"
    assert service.validate(b"PK\x03\x04 body").mime == DOCX_MIME
    assert service.validate(b"body\n").mime == "text/plain"
    assert service.validate(b"").mime == "text/plain"


def test_the_first_claiming_strategy_wins_and_sees_the_body() -> None:
    claimer = ClaimingStrategy()
    service = DocumentValidationService(strategies=(AcknowledgingStrategy(), claimer))

    outcome = service.validate(b"the body")

    assert outcome.mime == "text/plain"
    assert claimer.seen == b"the body"


def test_the_first_claim_halts_the_pass_so_later_strategies_never_run() -> None:
    claimer = ClaimingStrategy()
    following = AcknowledgingStrategy()
    service = DocumentValidationService(strategies=(claimer, following))

    outcome = service.validate(b"body")

    assert outcome.mime == "text/plain"
    assert claimer.seen == b"body"
    assert following.seen is None


def test_a_full_registry_decline_raises_unsupported_type_naming_the_junk() -> None:
    service = DocumentValidationService(strategies=(AcknowledgingStrategy(),))

    with pytest.raises(UnsupportedTypeError, match="image/png") as excinfo:
        service.validate(b"\x89PNG\r\n\x1a\n\r\n pixel body")

    assert "unsupported document type" in str(excinfo.value)


class ClaimingStrategy(DocumentValidationStrategy):
    """Claims any body handed to it; records the last one it saw."""

    def __init__(self) -> None:
        self.seen: bytes | None = None

    def validate(self, data: bytes) -> ValidationOutcome | None:
        self.seen = data
        return ValidationOutcome(mime="text/plain")


class AcknowledgingStrategy(DocumentValidationStrategy):
    """Declines everything; records the body it was consulted with."""

    def __init__(self) -> None:
        self.seen: bytes | None = None

    def validate(self, data: bytes) -> ValidationOutcome | None:
        self.seen = data
        return None
