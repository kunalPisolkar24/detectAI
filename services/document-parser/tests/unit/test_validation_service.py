"""The registry contract, pinned before any strategy logic exists.

build_default_service is the production composition: PDF, DOCX, then TXT —
text last, because a decodable body would otherwise claim the
classification ahead of the magic-prefixed types. The ABC shape stays
abstract: a strategy without a validate is not instantiable.
"""

import pytest

from app.validation import DocumentValidationService, build_default_service
from app.validation.strategies import (
    DocumentValidationStrategy,
    DocxValidationStrategy,
    PdfValidationStrategy,
    TextValidationStrategy,
)


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
