# Text Cleaning Design

How extracted text is cleaned before it leaves the service. Requirements live in [requirements.md](requirements.md); the wire flag it feeds is `truncated` in [http.md](http.md).

**Fidelity promise:** the response is cleaned, normalized text — no running headers, no footers, no page folios — with the document's own line structure preserved.

## Two phases, ownership split by format knowledge

**Phase 1 — per-format suppression, inside the parser.** Header/footer removal needs the document's structure, so it happens where that structure is known:

| Type | Suppression rules |
|------|-------------------|
| PDF | (a) Position-consistent repetition — see below. (b) Edge-zone folio drop — see below |
| DOCX | Nothing beyond the format: body paragraphs only; headers, footers, and footnotes live in separate document parts that are never read. Legacy field-char remnants (`\x13\x14\x15`) are stripped |
| TXT | No structure to exploit — phase 2 patterns only |

### Rule (a): position-consistent repetition

A line is a running header/footer when **all** of these hold:

1. Its whitespace-**and digit-normalized** text appears on at least 80% of pages (`HEADER_REPETITION_RATIO`).
2. It occupies a consistent vertical position — the same y band (within 2% of page height, `EDGE_TOLERANCE_RATIO`) on every page where it appears.
3. The document has at least 4 pages (`REPETITION_MIN_PAGES`); below that rule (a) is skipped entirely.

Why each condition: digit normalization makes `Page 3 of 10` and `Page 4 of 10` collapse to the comparison key `Page # of #` (the output line is untouched — normalization exists only for matching, and it also folds varying headers like `Smith — Chapter 2 — 47` into one key). Position consistency is what separates running headers from repeated **table labels**, which drift vertically across pages and therefore survive — resolving the potential contradiction between rule (a) and the test anchor "repeated table labels survive". The minimum page count stops tiny documents from dying on coincidence: on a 3-page PDF, 80% means 3 of 3 pages, and one stray repeat would erase a real line.

### Rule (b): edge-zone folio drop

Deletion requires **position and content to agree** — all four conditions:

1. The block sits in the outer **10% of page height, per edge** (`EDGE_ZONE_RATIO`; proportional and evaluated per page, so page size and margin conventions are not inputs to correctness).
2. It is a **single line** — folios are; multi-line blocks near edges are usually real content.
3. Its text is **folio-shaped**: a bare integer, a roman numeral, `Page N of M`, or `- N -`.
4. Where a numeral is parseable, it is **roughly monotonic with the page index** — strictly increasing or decreasing within a tolerance that permits duplicates and gaps (front-matter numbering, skipped folios), with direction consistent across the document.

Condition 4 near-eliminates false positives for a year-like bare number or an equation marker `(4)`: a folio tracks the page index, a lone number does not. Position alone never deletes arbitrary text — the only assumption the rule makes is "folios look like folios", which holds across real-world PDFs independent of layout. The fixed absolute margin band of the old service (40pt) is gone deliberately: varying margins made it unsafe in both directions (body text eaten on tight pages, folios surviving on loose ones).

## Phase 2 — one shared normalizer, all types

Ordered, pure, string-in/string-out; applied once after phase 1. The output cap applies after cleaning (see [http.md](http.md)):

1. Line endings normalized (CRLF/CR → LF)
2. Control and invisible characters dropped — `U+0000–0008`, `000B–001F`, `007F–009F`, zero-widths (`200B/200C/200D/2060`), BOM (`FEFF`). Tabs are whitespace, not deleted
3. NBSP → space
4. Hyphenated line breaks rejoined: `docu-\nment` → `document` (only when followed by a word character)
5. Page-number artifacts dropped anywhere in the text: `Page N of M` (case-insensitive) and standalone `- N -` lines — cheap safety for TXT and stragglers
6. Whitespace collapse: runs of spaces/tabs → one space; leading and trailing whitespace per line; 3+ consecutive newlines → exactly 2 (paragraph breaks preserved, `docu ment`-style gaps never signal structure)
7. Trim ends

## Configuration knobs

| Env | Default | Governs |
|-----|---------|---------|
| `HEADER_REPETITION_RATIO` | 0.8 | rule (a) repetition threshold, as share of pages |
| `REPETITION_MIN_PAGES` | 4 | below it, rule (a) is skipped entirely |
| `EDGE_ZONE_RATIO` | 0.10 | rule (b) edge-zone depth, per edge, proportional to page height |
| `EDGE_TOLERANCE_RATIO` | 0.02 | rule (a) y-band consistency tolerance |

All env-configurable at boot and fail-closed like every bound.

## Decided trade-offs and known gaps

Listed so tests are not the first place they surface:

- **A repeated line below the ratio threshold is kept** — e.g. a chapter-bounded running header on 60% of pages. Bounded false outputs beat unbounded false negatives.
- **Scanned / OCR-only PDFs produce nothing** — text layer only, no OCR; a zero-extractable-text result is a 422 like a corrupt document.
- **Rotated pages** extract as written; a rotated folio may miss the edge zone and survive.
- **Two-column layouts** are extracted in the library's reading order; no re-flow, no column inference.
- **No bare-number line suppression outside the edge zone** — deleting every line that is just `12` would eat table cells, list items, and years.

## Test anchors

- Tight-margin PDF: the first body line survives rule (b); a folio at odd offsets is dropped
- Digit-normalized repetition: `Page 3 of 10`-style variants on every page are all dropped
- Below `REPETITION_MIN_PAGES`: a line repeated on every page of a 3-page document survives
- A table label repeated across pages at drifting y survives
- A running header at stable y across ≥ `REPETITION_MIN_PAGES` pages is dropped
- A chapter header below the ratio threshold survives
- Bare year-like numerals stay intact; the folio monotonic check passes on front-matter roman/numeric sequences with duplicates and gaps
- Rule-list cases port from the existing corpus: control chars, hyphen rejoin, `Page x of y`, `- N -`, blank collapse — same expectations, new owner
