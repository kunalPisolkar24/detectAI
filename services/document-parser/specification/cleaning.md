# Text Cleaning Design

How extracted text is cleaned before it leaves the service. Requirements live in [requirements.md](requirements.md); the wire flag it feeds is `truncated` in [http.md](http.md).

**Fidelity promise (best effort):** the response is cleaned, normalized text; running headers, footers, and page folios are suppressed on a best-effort basis — repeated lines below the thresholds are deliberately kept — and the document's own line structure is preserved.

## Two phases, ownership split by format knowledge

**Phase 1 — per-format suppression, inside the parser.** Header/footer removal needs the document's structure, so it happens where that structure is known:

| Type | Suppression rules |
|------|-------------------|
| PDF | (a) Position-consistent repetition in the edge zone. (b) Edge-zone folio drop — see below |
| DOCX | Nothing beyond the format: body paragraphs only; headers, footers, and footnotes live in separate document parts that are never read. Legacy field-char remnants (`\x13\x14\x15`) are stripped |
| TXT | No structure to exploit — phase 2 patterns only |

### Rule (a): position-consistent repetition in the edge zone

A line is a running header/footer when **all** of these hold:

1. It sits in the outer **20% of page height, per edge** (`HEADER_EDGE_ZONE_RATIO`; proportional, evaluated per page). Repetition on its own is a strong but blunt signal — without a location constraint, a template-style PDF (invoices, forms) would lose a `Total:` label printed at the same y on every page, recreating the class of bug the fixed 40pt band had. The wide zone is intentional: rule (a)'s checks are consistency-only, while rule (b) has strict shape and ordering checks but a narrower zone — each rule deletes only inside the zone its rigor can afford.
2. Its whitespace-**and digit-normalized** text is equal on at least 80% of pages (`HEADER_REPETITION_RATIO`): `Page 3 of 10` and `Page 4 of 10` collapse to the comparison key `Page # of #`; the output line is untouched — normalization exists only for matching, and it also folds varying headers like `Smith — Chapter 2 — 47` into one key.
3. It occupies a consistent vertical position — the same y band (within 2% of page height, `EDGE_TOLERANCE_RATIO`) wherever it appears.
4. The document has at least 4 pages (`REPETITION_MIN_PAGES`); below that, rule (a) is skipped entirely — on a 3-page PDF the threshold means "every page", and one stray repeat would erase a real line.

**Exclusion — pure-digit keys route only through rule (b).** A comparison key that normalizes to placeholders/digits alone (a bare `12` reduces to `#`) can never be deleted by rule (a); folio-shaped numerals are governed exclusively by rule (b), so the monotonic-with-page-index check can never be bypassed. Keys containing any non-placeholder text (`Page # of #`) remain eligible.

Position consistency is what separates running headers from repeated **table labels**, which drift vertically across pages and therefore survive — even inside the edge zone. Body-position template content is never eligible under any condition.

### Rule (b): edge-zone folio drop

Deletion requires **position, shape, and ordering to agree** — all four conditions; position alone never deletes.

1. The block sits in the outer **10% of page height, per edge** (`EDGE_ZONE_RATIO`; proportional and evaluated per page, so page size and margin conventions are not inputs to correctness).
2. It is a **single line** — folios are; multi-line blocks near edges are usually real content.
3. Its text is **folio-shaped**: a bare integer, a roman numeral, `Page N of M`, or `- N -`.
4. **Roughly monotonic with the page index**, testable as follows:
   - **Few candidates:** if fewer than 3 folio-shaped blocks exist in the document, they are all kept — there is no aggregate evidence to judge against, and failing closed loses nothing.
   - **Candidates and pairs:** order the folio-shaped blocks by page index; condition 4 is evaluated over consecutive pairs between them.
   - **Direction:** the majority direction across parseable pairs decides (increasing or decreasing); equal values count as compliant, and gaps in front-matter/skipped folios are permitted.
   - **Score:** at least 70% of consecutive pairs per numbering run comply with the chosen direction (`FOLIO_MONOTONIC_RATIO`).
   - **Restarted numbering:** a significant downward step splits the sequence into **numbering runs** (roman front matter, then arabic restarting at 1); monotonicity is evaluated per run — a restart is not evidence against the folio interpretation, so each run must independently pass the score.
   - **Unparseable values:** blocks whose numeral cannot be parsed never contribute a non-compliant pair; if no candidate is parseable, all are kept. A pair scores as compliant unless a concrete decrease contradicts the chosen direction.

A year-like bare number or an equation marker `(4)` fails condition 4 on any multi-page document: a folio tracks the page index, a lone repeated or arbitrary number does not. Position alone never deletes — the only assumption the rule makes is "folios look like folios", which holds across real-world PDFs independent of layout. The fixed absolute margin band of the old service (40pt) is gone deliberately: varying margins made it unsafe in both directions (body text eaten on tight pages, folios surviving on loose ones).

## Phase 2 — one shared normalizer, all types

Ordered, pure, string-in/string-out; applied once after phase 1. The output cap applies after cleaning (see [http.md](http.md)):

1. Line endings normalized (CRLF/CR → LF; Unicode line/paragraph separators `U+2028`/`U+2029` → LF)
2. Control and invisible characters dropped — `U+0000–0008`, `000B–001F`, `007F–009F`, zero-widths (`200B/200C/200D/2060`), BOM (`FEFF`), and soft hyphens (`00AD`, common in PDF output and directly related to hyphenation). Tabs are whitespace, not deleted
3. NBSP → space
4. Hyphenated line breaks rejoined: `docu-\nment` → `document` (only when followed by a word character)
5. Page-number artifacts dropped **only as whole lines**: a line is removed when, after trimming, it consists entirely of `Page N of M` (case-insensitive) or `- N -` plus surrounding whitespace. Mid-sentence references survive — `see Page 3 of 10 in the appendix` is untouched
6. Whitespace collapse: runs of spaces/tabs → one space; leading and trailing whitespace per line; 3+ consecutive newlines → exactly 2 paragraph breaks
7. Trim ends

## Configuration knobs

| Env | Default | Valid range | Governs |
|-----|---------|-------------|---------|
| `HEADER_REPETITION_RATIO` | 0.8 | (0, 1) exclusive | rule (a) repetition threshold, as share of pages |
| `REPETITION_MIN_PAGES` | 4 | ≥ 2 | below it, rule (a) is skipped entirely |
| `HEADER_EDGE_ZONE_RATIO` | 0.20 | (0, 0.5) exclusive | rule (a) deletion zone, per edge |
| `EDGE_ZONE_RATIO` | 0.10 | (0, 0.5) exclusive | rule (b) deletion zone, per edge |
| `EDGE_TOLERANCE_RATIO` | 0.02 | (0, 1) exclusive | rule (a) y-band consistency tolerance |
| `FOLIO_MONOTONIC_RATIO` | 0.70 | (0, 1) exclusive | rule (b) per-run pair-compliance score |

Failure behavior for cleaning knobs is deliberately stricter than the response bounds: an out-of-range or invalid value **fails the boot** — deletion rules are never silently loosened by a bad value falling back to a default.

## Decided trade-offs and known gaps

Listed so tests are not the first place they surface:

- **A repeated line below the ratio threshold is kept** — e.g. a chapter-bounded running header on 60% of pages. Bounded false outputs beat unbounded false negatives.
- **In-zone template remnants under rule (a)** — a form or signature label printed at a stable y *inside the wide edge zone* on enough pages is deleted; form fields mostly occupy the protected middle band, but in-zone originals are accepted losses of the consistency-only rule.
- **Hyphen rejoin can merge real compounds** — `well-\nknown` becomes `wellknown`; without a dictionary there is no general rule, this is a known trade-off.
- **Scanned / OCR-only PDFs produce nothing** — text layer only, no OCR; a zero-extractable-text result is a 422 like a corrupt document.
- **Rotated pages** extract as written; a rotated folio may miss the edge zones and survive.
- **Two-column layouts** are extracted in the library's reading order; no re-flow, no column inference.
- **No bare-number line suppression outside rule (b)** — deleting every line that is just `12` would eat table cells, list items, and years.

## Test anchors

- Tight-margin PDF: the first body line survives rule (b); a folio at odd offsets is dropped
- **Rule (a) zone check:** a template-style label at a stable y **in the body**, repeated on every page, survives regardless of repetition (the fix-1 anchor)
- **Rule (b) monotonic check:** a bare numeral at a stable y in the edge zone that does not track the page index (the same fixed year across pages) survives (the fix-2 anchor)
- **Repetition boundary:** the smallest page count satisfying the 80% threshold is dropped; one page fewer is kept
- **Digit-normalized repetition:** `Page 3 of 10`-style variants on every page are all dropped, and normalization leaves output text untouched — a matching line kept in a body position still reads `Page 12 of 40`
- **Pure-digit exclusion:** `12` at a stable y on every page, inside the edge zone, is decided by rule (b)'s monotonic check only — non-monotonic → survives
- **Few candidates:** fewer than 3 folio-shaped blocks — all kept
- **Restarted numbering:** roman front matter (`i…iv`) followed by arabic restarting at 1 passes per-run scoring — both populations are dropped when each run complies
- Below `REPETITION_MIN_PAGES`: a line repeated on every page of a 3-page document survives
- A table label repeated across pages at drifting y survives
- A running header at stable y inside the header edge zone across ≥ `REPETITION_MIN_PAGES` pages is dropped
- A chapter header below the ratio threshold survives
- Bare year-like numerals and equation markers stay intact; the folio monotonic check passes on front-matter roman/numeric sequences with duplicates and gaps
- Line-anchored page patterns: `see Page 3 of 10 in the appendix` is untouched; a line that is only `Page 2 of 4` is removed
- Rule-list cases port from the existing corpus: control chars, hyphen rejoin, blank collapse — same expectations, new owner
