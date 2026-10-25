"""The registry contract and its orchestration, pinned end to end.

build_default_service is the production composition: PDF, DOCX, then TXT —
text last, because a decodable body would otherwise claim the
classification ahead of the magic-prefixed types. Orchestration gets its
own table: first outcome wins, a full decline names the junk, and the ABC
shape stays abstract — a strategy without a validate is not instantiable.
"""

import pytest

from app.validation import (
    DEFAULT_MAX_PDF_PAGES,
    CorruptDocumentError,
    DocumentValidationService,
    TooLargeError,
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
from tests.support.documents import minimal_docx_bytes, minimal_pdf_bytes

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def test_default_registry_composes_the_three_types_in_contract_order() -> None:
    strategies = build_default_service().strategies

    assert [type(strategy) for strategy in strategies] == [
        PdfValidationStrategy,
        DocxValidationStrategy,
        TextValidationStrategy,
    ]


def test_a_service_runs_whatever_registry_it_is_handed() -> None:
    registry: tuple[DocumentValidationStrategy, ...] = (PdfValidationStrategy(max_pages=DEFAULT_MAX_PDF_PAGES),)

    service = DocumentValidationService(registry)

    assert service.strategies == registry


def test_the_strategy_contract_cannot_be_skipped() -> None:
    # The contract is enforced at construction; routing through a plain
    # type keeps that check runtime-only (an abstract class cannot be
    # constructed directly).
    contract: type = DocumentValidationStrategy
    with pytest.raises(TypeError):
        contract()


def test_the_default_registry_admits_every_supported_type() -> None:
    service = build_default_service()

    assert service.validate(minimal_pdf_bytes(1)).mime == "application/pdf"
    assert service.validate(minimal_docx_bytes()).mime == DOCX_MIME
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


@pytest.mark.parametrize(
    "rejection",
    [
        TooLargeError("the pdf exceeds the 2-page limit"),
        CorruptDocumentError("the docx container did not open"),
        UnsupportedTypeError("unsupported document type: image/png"),
    ],
)
def test_a_typed_rejection_rides_the_registry_and_halts_the_pass(rejection: Exception) -> None:
    following = AcknowledgingStrategy()
    service = DocumentValidationService(strategies=(RejectingStrategy(rejection), following))

    with pytest.raises(type(rejection)):
        service.validate(b"body")

    assert following.seen is None


class RejectingStrategy(DocumentValidationStrategy):
    """Raises the typed rejection it was constructed with, every time."""

    def __init__(self, error: Exception) -> None:
        self._error = error

    def validate(self, data: bytes) -> ValidationOutcome | None:
        raise self._error


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
