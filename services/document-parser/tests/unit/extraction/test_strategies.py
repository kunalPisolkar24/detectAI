"""The per-format strategies: text's strict decode, the docx body walk
and its field handling, and the failure vocabulary they raise."""

import pytest

from app.extraction.models import (
    BudgetExhaustedError,
    Deadline,
    RawLines,
    UnreadableDocumentError,
)
from app.extraction.strategies import DocxExtractionStrategy, TextExtractionStrategy
from tests.support.documents import (
    docx_body_bytes,
    minimal_docx_bytes,
    paragraphed_docx_bytes,
    surrogate_zip_bytes,
)

_FAR_DEADLINE = Deadline.from_budget(10.0)


def test_the_text_strategy_decodes_its_body_into_lines() -> None:
    outcome = TextExtractionStrategy().extract(b"first\nsecond\nthird", _FAR_DEADLINE)

    assert outcome == RawLines(["first", "second", "third"], partial=False)


def test_the_text_strategy_accepts_the_empty_body() -> None:
    assert TextExtractionStrategy().extract(b"", _FAR_DEADLINE) == RawLines([], partial=False)


def test_the_text_strategy_owns_a_failed_decode() -> None:
    with pytest.raises(UnreadableDocumentError):
        TextExtractionStrategy().extract(b"\xff\xfe\x00", _FAR_DEADLINE)


def test_the_docx_walk_emits_paragraphs_in_document_order() -> None:
    outcome = DocxExtractionStrategy().extract(paragraphed_docx_bytes(["first", "second"]), _FAR_DEADLINE)

    assert outcome == RawLines(["first", "second"], partial=False)


def test_an_empty_docx_body_is_a_valid_empty_result() -> None:
    assert DocxExtractionStrategy().extract(minimal_docx_bytes(), _FAR_DEADLINE) == RawLines(
        [], partial=False
    )


def test_tabs_breaks_and_blanks_arrive_raw_for_the_pipeline() -> None:
    # The strategy never pre-massages: tabs stay tabs, breaks stay
    # breaks, blank paragraphs skip, and phase 2 normalizes (cleaning.md).
    inner = (
        "<w:p><w:r><w:t>  keep</w:t><w:tab/><w:t>tabbed</w:t></w:r></w:p>"
        "<w:p/>"
        "<w:p><w:r><w:t>line</w:t><w:br/><w:t>continued</w:t></w:r></w:p>"
    )
    outcome = DocxExtractionStrategy().extract(docx_body_bytes(inner), _FAR_DEADLINE)

    assert outcome == RawLines(["  keep\ttabbed", "line\ncontinued"], partial=False)


def test_field_instructions_drop_and_their_results_survive() -> None:
    inner = (
        "<w:p><w:r><w:t>page </w:t></w:r>"
        "<w:r><w:fldChar w:fldCharType='begin'/></w:r>"
        "<w:r><w:instrText>PAGE \\* MERGEFORMAT</w:instrText></w:r>"
        "<w:r><w:fldChar w:fldCharType='separate'/></w:r>"
        "<w:r><w:t>7</w:t></w:r>"
        "<w:r><w:fldChar w:fldCharType='end'/></w:r></w:p>"
        "<w:p><w:r><w:t>after</w:t></w:r></w:p>"
    )
    outcome = DocxExtractionStrategy().extract(docx_body_bytes(inner), _FAR_DEADLINE)

    assert outcome == RawLines(["page 7", "after"], partial=False)


def test_a_field_without_a_separator_emits_nothing() -> None:
    inner = (
        "<w:p><w:r><w:fldChar w:fldCharType='begin'/></w:r>"
        "<w:r><w:instrText>TIME</w:instrText></w:r>"
        "<w:r><w:fldChar w:fldCharType='end'/></w:r></w:p>"
        "<w:p><w:r><w:t>kept</w:t></w:r></w:p>"
    )
    outcome = DocxExtractionStrategy().extract(docx_body_bytes(inner), _FAR_DEADLINE)

    assert outcome == RawLines(["kept"], partial=False)


def test_table_nested_paragraphs_are_body_content_in_reading_order() -> None:
    inner = (
        "<w:p><w:r><w:t>before</w:t></w:r></w:p>"
        "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell one</w:t></w:r></w:p></w:tc>"
        "<w:tc><w:p><w:r><w:t>cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>"
        "<w:p><w:r><w:t>after</w:t></w:r></w:p>"
    )
    outcome = DocxExtractionStrategy().extract(docx_body_bytes(inner), _FAR_DEADLINE)

    assert outcome == RawLines(["before", "cell one", "cell two", "after"], partial=False)


def test_a_zero_budget_abandons_at_the_first_member_element() -> None:
    with pytest.raises(BudgetExhaustedError):
        DocxExtractionStrategy().extract(paragraphed_docx_bytes(["one", "two"]), Deadline.from_budget(0.0))


def test_malformed_body_xml_is_unreadable() -> None:
    with pytest.raises(UnreadableDocumentError):
        DocxExtractionStrategy().extract(docx_body_bytes("<w:p><w:r><w:t>unclosed"), _FAR_DEADLINE)


def test_a_zip_without_the_body_part_is_unreadable_here_too() -> None:
    with pytest.raises(UnreadableDocumentError):
        DocxExtractionStrategy().extract(surrogate_zip_bytes(["word/other.xml"]), _FAR_DEADLINE)
