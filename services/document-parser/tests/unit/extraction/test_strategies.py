"""The per-format strategies: text's strict decode, the docx body walk
and its field handling, the pdf block walk and its phase-1 suppression
(rules a/b), and the failure vocabulary they raise."""

from typing import Self

import pymupdf
import pytest

from app.extraction import CleaningKnobs
from app.extraction.models import (
    BudgetExhaustedError,
    Deadline,
    RawLines,
    UnreadableDocumentError,
)
from app.extraction.strategies import (
    DocxExtractionStrategy,
    PdfExtractionStrategy,
    TextExtractionStrategy,
)
from tests.support.documents import (
    docx_body_bytes,
    minimal_docx_bytes,
    minimal_pdf_bytes,
    paragraphed_docx_bytes,
    positioned_pdf_bytes,
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


# -- the pdf block walk: phase-1 anchors from cleaning.md ---------------------

_KNOBS = CleaningKnobs()
_BODY_WORDS = ("alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota")


def _bodies(count: int) -> list[str]:
    """Distinct mid-page body lines: different words, so no two share a
    rule-(a) key even after digit normalization."""
    return [f"Chapter body {word}." for word in _BODY_WORDS[:count]]


def _header_pages(header: str, repeat_y: float, on_pages: int, total: int) -> bytes:
    """`on_pages` of `total` pages carry the header line at `repeat_y`;
    every page carries its own body line at mid-page."""
    return positioned_pdf_bytes(
        [
            ([(repeat_y, header)] if index < on_pages else []) + [(400.0, body)]
            for index, body in enumerate(_bodies(total))
        ]
    )


def test_a_folio_at_an_odd_offset_drops_when_it_tracks_the_pages() -> None:
    # y=58 is 58pt above the bottom edge — not the old fixed 40pt band,
    # but inside rule (b)'s proportional 10% zone of this page size.
    document = positioned_pdf_bytes(
        [[(58.0, f"- {index + 1} -"), (400.0, body)] for index, body in enumerate(_bodies(5))]
    )

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.partial is False
    assert outcome.lines == _bodies(5)


def test_a_bare_numeral_that_never_tracks_the_pages_survives() -> None:
    # The fix-2 anchor and the rule-(a) exclusion at once: the same fixed
    # year at a stable y is a placeholder-only key, routed to rule (b)
    # only — and equal values give no majority direction, so nothing
    # deletes.
    bodies = _bodies(5)
    document = positioned_pdf_bytes([[(40.0, "2024"), (400.0, body)] for body in bodies])

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [line for body in bodies for line in ("2024", body)]


def test_a_header_repeated_below_the_repetition_floor_survives() -> None:
    document = _header_pages("Quarterly ledger header", 745.0, 3, 3)

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for body in _bodies(3)
        for line in ("Quarterly ledger header", body)
    ]


def test_a_tight_margin_body_line_survives_the_folio_zone() -> None:
    # A 2-page document keeps rule (a) inert; the y=740 line sits inside
    # the 10% top band of a tight-margin page, and only its shape — not
    # folio-like — keeps it there under rule (b).
    document = positioned_pdf_bytes(
        [
            [(740.0, "Contents overview of the printed work"), (400.0, body)]
            for body in _bodies(2)
        ]
    )

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for body in _bodies(2)
        for line in ("Contents overview of the printed work", body)
    ]


def test_a_header_on_exact_four_of_five_pages_drops_at_the_ratio() -> None:
    # 4 >= 0.8 * 5 holds with zero slack: the smallest satisfying share.
    document = _header_pages("Quarterly report header", 745.0, 4, 5)

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == _bodies(5)


def test_a_header_on_three_of_five_pages_stays_whole() -> None:
    document = _header_pages("Quarterly report header", 745.0, 3, 5)

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for index, body in enumerate(_bodies(5))
        for line in ((["Quarterly report header"] if index < 3 else []) + [body])
    ]


def test_a_header_drifting_beyond_the_y_band_survives() -> None:
    # One draw's height of drift (~18pt = 2.3% of page height) is beyond
    # the 2% tolerance, so the five repeats never delete.
    ys = (745.0, 763.0, 745.0, 763.0, 745.0)
    document = positioned_pdf_bytes(
        [[(y, "Quarterly report header"), (400.0, body)] for y, body in zip(ys, _bodies(5))]
    )

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for body in _bodies(5)
        for line in ("Quarterly report header", body)
    ]


def test_a_body_position_template_label_survives_repetition() -> None:
    # The fix-1 anchor: the same label at a stable y in the body, on
    # every page, survives regardless of repetition — the wide zone is
    # the only place consistency may delete.
    document = positioned_pdf_bytes(
        [
            [(380.0, "Approved: signature required"), (300.0, body)]
            for body in _bodies(5)
        ]
    )

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for body in _bodies(5)
        for line in ("Approved: signature required", body)
    ]


def test_page_of_variants_drop_in_the_zone_and_stay_verbatim_in_body() -> None:
    # The in-zone copies collapse to one key (`page # of #`) and drop;
    # the normalization exists for matching only, so the body-position
    # copy keeps its exact text.
    pages = [
        [(730.0, f"Page {index + 1} of 10"), (400.0, body)]
        for index, body in enumerate(_bodies(5))
    ]
    pages[2].insert(1, (500.0, "Page 12 of 40"))

    outcome = PdfExtractionStrategy(_KNOBS).extract(positioned_pdf_bytes(pages), _FAR_DEADLINE)

    bodies = _bodies(5)
    assert outcome.lines == [bodies[0], bodies[1], "Page 12 of 40", *bodies[2:]]


def test_a_repeated_table_label_at_drifting_y_survives() -> None:
    # Same monotone drift inside the wide zone — the lost-consistency
    # case that separates running headers from table labels.
    ys = (745.0, 740.0, 735.0, 730.0, 725.0)
    document = positioned_pdf_bytes(
        [[(y, "Table continues below"), (400.0, body)] for y, body in zip(ys, _bodies(5))]
    )

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for body in _bodies(5)
        for line in ("Table continues below", body)
    ]


def test_a_folio_population_fewer_than_three_is_all_kept() -> None:
    # Rule (b) with two folios has no aggregate evidence to judge
    # against, and failing closed loses nothing (cleaning.md).
    pages = [[(400.0, body)] for body in _bodies(6)]
    pages[0].append((40.0, "42"))
    pages[1].append((40.0, "42"))

    outcome = PdfExtractionStrategy(_KNOBS).extract(positioned_pdf_bytes(pages), _FAR_DEADLINE)

    bodies = _bodies(6)
    assert outcome.lines == [bodies[0], "42", bodies[1], "42", *bodies[2:]]


def test_roman_front_matter_and_a_restarted_arabic_run_both_drop() -> None:
    # Front matter i, ii, iii rolling into a fresh arabic numbering:
    # the drop at iii -> 1 is a restart, not a violation, and each run
    # passes its own score — the roman and the arabic stay deleted.
    folios = ("i", "ii", "iii", "1", "2", "3", "4")
    bodies = (
        "Roman body one.", "Roman body two.", "Roman body three.",
        "Main body one.", "Main body two.", "Main body three.", "Main body four.",
    )
    document = positioned_pdf_bytes([[(40.0, folio), (400.0, body)] for folio, body in zip(folios, bodies)])

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == list(bodies)


def test_a_multi_line_edge_block_survives_rule_b() -> None:
    # Two ops one line-height apart group into a single MuPDF block: the
    # folio-shaped tail line is no longer a single-line block, so rule
    # (b) keeps it. Two pages keep rule (a) inert.
    document = positioned_pdf_bytes(
        [
            [(745.0, "Table 3 continued"), (729.0, "- 4 -"), (400.0, body)]
            for body in _bodies(2)
        ]
    )

    outcome = PdfExtractionStrategy(_KNOBS).extract(document, _FAR_DEADLINE)

    assert outcome.lines == [
        line
        for body in _bodies(2)
        for line in ("Table 3 continued", "- 4 -", body)
    ]


class _FakeRect:
    """The tall page the fake bboxes were written for."""

    height = 792.0


class _FakePage:
    """Mimics pymupdf.Page just enough for the walk: dict-mode text."""

    def __init__(self, blocks: list[dict]) -> None:
        self.rect = _FakeRect()
        self._blocks = blocks

    def get_text(self, kind: str) -> dict:
        assert kind == "dict"
        return {"blocks": self._blocks}


class _DamagedPage(_FakePage):
    """A page the walk cannot read at all."""

    def get_text(self, kind: str) -> dict:
        raise RuntimeError("damaged content stream")


class _FakeDocument:
    def __init__(self, pages: list[_FakePage]) -> None:
        self._pages = pages

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *unused_args: object) -> bool:
        return False

    def __iter__(self):
        return iter(self._pages)


def _small_block(text: str) -> dict:
    return {
        "type": 0,
        "lines": [{"bbox": (72.0, 34.1, 179.4, 50.6), "spans": [{"text": text}]}],
    }


def test_an_unreadable_page_reports_partial_while_the_rest_extracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = _FakeDocument([
        _FakePage([_small_block("Header enough one"), _small_block("Body enough alpha")]),
        _DamagedPage([]),
        _FakePage([_small_block("Header enough three"), _small_block("Body enough gamma")]),
    ])
    monkeypatch.setattr(pymupdf, "open", lambda *, stream, filetype: document)

    outcome = PdfExtractionStrategy(_KNOBS).extract(b"whatever the fake accepts", _FAR_DEADLINE)

    assert outcome == RawLines(
        ["Header enough one", "Body enough alpha", "Header enough three", "Body enough gamma"],
        partial=True,
    )


def test_every_unreadable_page_is_a_422_not_an_empty_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    document = _FakeDocument([_DamagedPage([]), _DamagedPage([])])
    monkeypatch.setattr(pymupdf, "open", lambda *, stream, filetype: document)

    with pytest.raises(UnreadableDocumentError, match="no text at all"):
        PdfExtractionStrategy(_KNOBS).extract(b"anything", _FAR_DEADLINE)


@pytest.mark.parametrize("garbage", [b"not a pdf at all", b"%PDF-1.7 no objects", b""])
def test_a_container_the_library_rejects_is_unreadable_content(garbage: bytes) -> None:
    with pytest.raises(UnreadableDocumentError):
        PdfExtractionStrategy(_KNOBS).extract(garbage, _FAR_DEADLINE)


def test_a_spent_budget_abandons_at_the_first_page() -> None:
    document = positioned_pdf_bytes([[(400.0, "Chapter body alpha.")]])

    with pytest.raises(BudgetExhaustedError):
        PdfExtractionStrategy(_KNOBS).extract(document, Deadline.from_budget(0.0))


def test_a_scanned_pdf_reads_like_an_unreadable_document() -> None:
    # One real blank page: zero extractable text is the 422, not an
    # empty success (cleaning.md's zero-tag decision).
    with pytest.raises(UnreadableDocumentError, match="no text at all"):
        PdfExtractionStrategy(_KNOBS).extract(minimal_pdf_bytes(1), _FAR_DEADLINE)

