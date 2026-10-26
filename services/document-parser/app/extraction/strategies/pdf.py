"""PDF extraction: pymupdf v2's ordered blocks, rules (a)/(b) in the walk."""

import itertools
import re
from dataclasses import dataclass

import pymupdf

from ..models import (
    BudgetExhaustedError,
    CleaningKnobs,
    Deadline,
    RawLines,
    UnreadableDocumentError,
)
from .base import DocumentExtractionStrategy

_TEXT_BLOCK = 0
_FOLIO_MIN_CANDIDATES = 3  # fewer folios give rule (b) no aggregate evidence

# The folio shapes rule (b) deletes on: a bare integer, a roman numeral,
# `Page N of M` (its value is the page's own numeral), or `- N -`.
_ARABIC = re.compile(r"^\d+$")
_ROMAN = re.compile(r"^[ivxlcdm]+$", re.IGNORECASE)
_PAGE_OF = re.compile(r"^page\s+(\d+)\s+of\s+\d+$", re.IGNORECASE)
_DASHED = re.compile(r"^-\s*(\d+)\s*-$")
_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}

_PLACEHOLDER = "#"


@dataclass(frozen=True, slots=True)
class _Line:
    """One drawn text line: its raw text and where it sits on the page.

    Positions are fractions of the page height (0 at the top edge), so
    the deletion zones never care about page size or margin conventions
    (cleaning.md). alone_in_block is rule (b)'s single-line check: a
    block of one drawn line is folio territory, a block of several is
    usually real content.
    """

    text: str
    y_top: float
    y_bottom: float
    alone_in_block: bool


@dataclass(frozen=True, slots=True)
class _FolioCandidate:
    """A folio-shaped line in the narrow edge zone: identity plus the
    number its shape carries, ordered for the monotonic pairing."""

    page_index: int
    line_index: int
    value: int


class PdfExtractionStrategy(DocumentExtractionStrategy):
    """Extracts the ordered text of an admitted pdf.

    pymupdf v2 — imported as pymupdf, never the legacy fitz alias —
    opens the bounded bytes in a context manager (MuPDF holds C-land
    buffers the GC does not manage) and yields each page's drawn lines
    with coordinates. Phase-1 rules (a) and (b) run in this walk
    (cleaning.md); only the parser owns the structure both rules need.
    A page that fails to read is skipped and reported as partial — the
    remaining pages still extract — while a document that yields no
    text at all is UnreadableDocumentError, a scanned pdf reading like
    a corrupt one. expired() is checked before each page, so the budget
    overshoots by at most one page. Admission stays pypdf's job: no
    container sniffing and no page-count bound lives here
    (validation.md).
    """

    def __init__(self, knobs: CleaningKnobs) -> None:
        self._knobs = knobs

    @property
    def knobs(self) -> CleaningKnobs:
        """The thresholds this strategy's deletion rules run on."""
        return self._knobs

    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        """Raw ordered lines from the pdf's text blocks, running headers
        and page folios suppressed where the rules can afford it."""
        try:
            document = pymupdf.open(stream=data, filetype="pdf")
        except pymupdf.FileDataError as error:
            raise UnreadableDocumentError("the pdf would not open") from error
        with document:
            pages: list[list[_Line]] = []
            partial = False
            for page in document:
                if deadline.expired():
                    raise BudgetExhaustedError("the budget was spent between pages")
                try:
                    pages.append(self._page_lines(page))
                except Exception:  # noqa: BLE001 - unreadability is MuPDF- and proof-shaped
                    # A page the library cannot shape stays skipped (cleaning.md's
                    # "unreadable page"); the callers see it as partial. Raised
                    # shapes span the FzError family, python-assert failures,
                    # closed documents, and degenerate geometry — every one a
                    # discovered case, not a guessed one.
                    partial = True
                    pages.append([])
            if not any(lines for lines in pages):
                raise UnreadableDocumentError("the pdf yielded no text at all")
            deletions = self._repeated_zone_lines(pages) | self._folio_zone_lines(pages)
            return RawLines(
                [
                    line.text
                    for index, lines in enumerate(pages)
                    for position, line in enumerate(lines)
                    if (index, position) not in deletions
                ],
                partial=partial,
            )

    def _page_lines(self, page: pymupdf.Page) -> list[_Line]:
        """The page's drawn text lines in block order, vertical placement
        measured against the page's own height."""
        height = page.rect.height
        lines: list[_Line] = []
        drawn = page.get_text("dict")
        for block in drawn["blocks"]:
            if block.get("type") != _TEXT_BLOCK:
                continue
            drawn_lines = block.get("lines", [])
            for drawn_line in drawn_lines:
                bbox = drawn_line["bbox"]
                lines.append(
                    _Line(
                        text="".join(span.get("text", "") for span in drawn_line.get("spans", [])),
                        y_top=bbox[1] / height,
                        y_bottom=bbox[3] / height,
                        alone_in_block=len(drawn_lines) == 1,
                    )
                )
        return lines

    def _repeated_zone_lines(self, pages: list[list[_Line]]) -> set[tuple[int, int]]:
        """Rule (a) deletions: lines inside the wide header edge zone
        that share one normalized key on enough pages and hold one
        consistent y band — all four cleaning.md conditions, with the
        placeholder-only keys of the exclusion routed to rule (b) never
        deleted here."""
        page_count = len(pages)
        if page_count < self._knobs.repetition_min_pages:
            return set()
        zone = self._knobs.header_edge_zone_ratio
        groups: dict[str, list[tuple[int, int, float]]] = {}
        for page_index, lines in enumerate(pages):
            for position, line in enumerate(lines):
                if not line.text.strip() or not _inside_edge_zone(line, zone):
                    continue
                key = _comparison_key(line.text)
                if _placeholder_only(key):
                    continue
                groups.setdefault(key, []).append(
                    (page_index, position, (line.y_top + line.y_bottom) / 2)
                )
        deletions: set[tuple[int, int]] = set()
        for key, occurrences in groups.items():
            visible_on = {page_index for page_index, _, _ in occurrences}
            if len(visible_on) < self._knobs.header_repetition_ratio * page_count:
                continue
            centers = sorted(center for _, _, center in occurrences)
            if centers[-1] - centers[0] > self._knobs.edge_tolerance_ratio:
                continue
            deletions.update((page_index, position) for page_index, position, _ in occurrences)
        return deletions

    def _folio_zone_lines(self, pages: list[list[_Line]]) -> set[tuple[int, int]]:
        """Rule (b) deletions: folio-shaped single-line blocks inside the
        narrow edge zone whose numerals track the page index on the
        whole — position, shape, and ordering must all agree, so
        position alone never deletes (cleaning.md)."""
        zone = self._knobs.edge_zone_ratio
        candidates = [
            _FolioCandidate(page_index, position, value)
            for page_index, lines in enumerate(pages)
            for position, line in enumerate(lines)
            if _inside_edge_zone(line, zone)
            and line.alone_in_block
            and (value := _folio_value(line.text)) is not None
        ]
        return _monotonic_folios(candidates, self._knobs.folio_monotonic_ratio)


def _monotonic_folios(
    candidates: list[_FolioCandidate], folio_monotonic_ratio: float
) -> set[tuple[int, int]]:
    """The candidates that rule (b) may delete: all of them when the
    population agrees, none of it when the ordering disagrees — a
    partial delete is never an answer (cleaning.md keeps every
    unqualified candidate).

    Fewer than three folios give no aggregate evidence: kept. The
    majority direction over the consecutive pairs decides orientation —
    only ties leave none — and the compliance score runs per numbering
    run, where a value dropping below half its predecessor is a
    restarted sequence rather than a violation. Unparseable shapes were
    never candidates, so "no candidate parses" short-circuits there:
    nothing to pair, everything kept.
    """
    if len(candidates) < _FOLIO_MIN_CANDIDATES:
        return set()
    values = [candidate.value for candidate in candidates]
    pairs = list(itertools.pairwise(values))
    rises = sum(1 for before, after in pairs if after > before)
    falls = sum(1 for before, after in pairs if after < before)
    if rises == falls:
        return set()
    increasing = rises > falls
    runs: list[list[int]] = [[values[0]]]
    for before, after in pairs:
        if after < before / 2:
            runs.append([after])
        else:
            runs[-1].append(after)
    for run in runs:
        run_pairs = list(itertools.pairwise(run))
        compliant = sum(
            (after >= before) if increasing else (after <= before)
            for before, after in run_pairs
        )
        if run_pairs and compliant < folio_monotonic_ratio * len(run_pairs):
            return set()
    return {(candidate.page_index, candidate.line_index) for candidate in candidates}


def _inside_edge_zone(line: _Line, zone: float) -> bool:
    """Whether the whole line sits inside the outer `zone` share of the
    page height, at the top or the bottom edge."""
    return line.y_bottom <= zone or line.y_top >= 1.0 - zone


def _comparison_key(text: str) -> str:
    """The whitespace- and digit-normalized matching key of rule (a):
    case folded, every digit a placeholder, whitespace runs collapsed.
    Used for matching only — the output line is untouched."""
    return re.sub(r"\s+", " ", re.sub(r"\d", _PLACEHOLDER, text.casefold())).strip()


def _placeholder_only(key: str) -> bool:
    """The rule (a) exclusion: a key that reduces to placeholders alone
    (a bare `12` is `#`, `Page # of #` is not) never deletes here, so
    folio-shaped numerals cannot bypass rule (b)'s monotonic check."""
    return bool(key) and set(key) == {_PLACEHOLDER}


def _folio_value(text: str) -> int | None:
    """The numeral a folio-shaped line carries, None when the text is
    none of the shapes: candidacy belongs only to shaped lines, so an
    unparseable shape is simply kept rather than judged."""
    trimmed = text.strip()
    if match := _DASHED.match(trimmed):
        return int(match.group(1))
    if match := _PAGE_OF.match(trimmed):
        return int(match.group(1))
    if _ROMAN.fullmatch(trimmed):
        return _roman_value(trimmed)
    if _ARABIC.fullmatch(trimmed):
        return int(trimmed)
    return None


def _roman_value(text: str) -> int:
    """The subtractive parse of a roman numeral; the shape regex has
    already admitted every letter."""
    values = [_ROMAN_VALUES[letter] for letter in text.casefold()]
    total = 0
    for position, value in enumerate(values):
        if position + 1 < len(values) and values[position + 1] > value:
            total -= value
        else:
            total += value
    return total
