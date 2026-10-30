# Extraction

Extraction is the pipeline that turns admitted bytes into cleaned text. It has exactly one job per stage, done once: compute the deadline, hand off to one strategy by the sniffed MIME, clean the raw lines, apply the output cap.

## The pipeline

```mermaid
graph TB
    START(["start: admitted bytes + sniffed mime"]) --> DEADLINE["Deadline computed once<br/>from PROCESSING_BUDGET_SECONDS"]
    DEADLINE --> DISPATCH{"which strategy<br/>claims the mime?"}
    DISPATCH -->|"pdf"| PDFS["PyMuPDF block walk,<br/>header/footer suppression"]
    DISPATCH -->|"docx"| DOCXS["streamed body XML,<br/>one paragraph at a time"]
    DISPATCH -->|"txt"| TXTS["strict decode, lines"]
    DISPATCH -->|"none"| UNREAD["422: unreadable"] --> END(["end"])
    PDFS -->|"deadline hit<br/>between pages"| TIMEOUT["504: budget exceeded"] --> END
    DOCXS -->|"deadline hit<br/>between elements"| TIMEOUT
    PDFS -->|"nothing readable at all"| UNREAD
    PDFS --> LINES
    DOCXS --> LINES
    TXTS --> LINES
    LINES["RawLines:<br/>ordered lines + partial flag"] --> CLEAN["normalize():<br/>the shared line cleaner"]
    CLEAN --> CAP{"over the<br/>character cap?"}
    CAP -->|"yes"| CUT["200: exact prefix,<br/>truncated: true"]
    CAP -->|"no"| FULL["200: full text,<br/>truncated = partial flag"]
    CUT --> END
    FULL --> END
```

No strategy ever re-sniffs — dispatch keys on the sniffed MIME the admission gate already decided. The "none" branch is defense in depth: if the gate and the registry ever disagree, it fails closed as `UnreadableDocumentError` (422).

### The tail, apart

Everything after a strategy returns reads this small — cleaning and the cap in one picture.

```mermaid
graph TB
    START(["start: RawLines from any strategy"]) --> CLEAN["normalize(): one ordered pass —<br/>LF reunify · invisible drop · nbsp to space<br/>hyphen rejoin · page-marker drop · space and blank collapse"] --> CAP{"over the<br/>character cap?"}
    CAP -->|"yes"| CUT["200: the exact prefix,<br/>truncated: true"] --> END(["end"])
    CAP -->|"no"| FULL["200: full text,<br/>truncated = the partial flag"] --> END
```

## One extract call, as a conversation

Who holds the deadline, who owns the cap — in call order.

```mermaid
sequenceDiagram
    autonumber
    participant R as route
    participant S as extraction service
    participant X as the strategy by sniffed mime
    participant N as normalize()

    R->>S: extract(admitted bytes, mime)
    S->>S: Deadline.from_budget(budget) — computed once
    S->>X: extract(data, deadline)
    X-->>S: RawLines — ordered lines, partial flag
    S->>N: the ordered lines
    N-->>S: cleaned text, one pure pass
    S->>S: enforce the character cap once, set truncated
    S-->>R: ExtractionResult (text, truncated)
    note over X: the deadline is checked inside the strategy's loops — between pages or member elements
```

## The deadline

Computed **once** per request, on the monotonic clock, from `PROCESSING_BUDGET_SECONDS` (10 s by default) and carried down as a value. Strategies check it in their inner loops — between PDF pages, between DOCX members. TXT never checks (one decode is the whole format).

| Question | Answer |
|----------|--------|
| What happens on expiry? | `BudgetExhaustedError` → shaped `504` |
| Why not a hard abort mid-page? | Between-steps checks keep the overshoot ≤ one page or one member element |
| What guarantees termination at all? | The interior caps — 1,000 pages, 30 MiB unpacked XML, 1,000,000 output chars |

## The three strategies

| Strategy | How it reads | What it can add |
|----------|--------------|-----------------|
| **PDF** (`PyMuPDF`) | ordered text blocks with line coordinates, page by page | skips unreadable pages → `partial: true`; the edge-zone suppression below |
| **DOCX** | streams `word/document.xml` with `iterparse`, holding one paragraph at a time | keeps legacy field *results*, drops field *instructions* |
| **TXT** | one strict UTF-8 decode, split into lines | — |

### Reading order preserved, junk suppressed (PDF)

The PDF walker keeps every text block in reading order and records where each line sits on its page (as a fraction of page height). Two rules delete only what deserves deletion:

- **Rule (a) — running headers/footers:** the *same* text (after digit-normalization) appearing near the top or bottom edge on most pages within a tiny vertical drift — banners, corner boilerplate. Placeholder-only keys (`---`, `###`) are ignored so separator art never triggers it.
- **Rule (b) — folio/page numbers:** lines in the edge zone that are alone in their block, shaped like a page number (`- 7 -`, `7`, `vii`, `Page 7 of 30`), where the whole document's candidates read as a mostly-monotonic growing sequence. Position alone never deletes anything — shape, position, and ordering must all agree.

Both rules tune via the cleaning knobs listed in [Configuration](../getting-started/configuration.md); the defaults keep deletions conservative.

## Cleaning: the shared normalizer

`normalize()` is a pure function — strings in, string out — applied to every format identically, in this order:

1. reunify line endings to `\n` (CRLF, old Mac endings, Unicode separators)
2. delete control and invisible characters (zero-width, BOM, soft hyphens)
3. map non-breaking spaces to plain spaces
4. rejoin hyphenated line breaks (`exam-\nple` → `example`)
5. delete whole-line page markers (`Page 3 of 30`, `- 3 -`)
6. collapse space/tab runs, then collapse 3+ consecutive newlines into exactly one blank line

This is also why the load rig's fixture grammar (see [Testing](../guides/testing.md)) deliberately dodges every rule above: for those documents, extraction output equals the fitted text exactly — or the exact capped prefix.

## The cap and the `truncated` flag

One cap, one owner, one flag meaning. The service enforces `OUTPUT_CHAR_LIMIT` (1,000,000 chars) *once, after cleaning*, for all three formats — the old per-parser early-exits (and their TXT bypass) are gone.

| Situation | Response |
|-----------|----------|
| Full text below the cap | `text` complete, `truncated: false` (unless partial) |
| Text over the cap | exactly the first 1,000,000 chars, `truncated: true` — **not an error** |
| PDF with unreadable pages (but some text) | the readable text, `truncated: true` (partial folded in) |

`truncated` says one thing in both cases: *the returned text is not the complete extractable text*. Callers don't — and shouldn't — know why.

## The vocabulary

A handful of frozen dataclasses, one abstract seam, one registry owner. The shapes below stay deliberately small — the next view is the same set with every data member filled in.

```mermaid
classDiagram
    class DocumentExtractionService {
        -registry
        -outputCharLimit
        +extract(data, mime)
    }
    class DocumentExtractionStrategy {
        <<abstract>>
        +extract(data, deadline)
    }
    class PdfExtractionStrategy
    class DocxExtractionStrategy
    class TextExtractionStrategy
    class Deadline {
        +from_budget(seconds)
        +expired()
    }
    class RawLines {
        +lines
        +partial
    }
    class ExtractionResult {
        +text
        +truncated
    }
    class CleaningKnobs
    DocumentExtractionStrategy <|-- PdfExtractionStrategy
    DocumentExtractionStrategy <|-- DocxExtractionStrategy
    DocumentExtractionStrategy <|-- TextExtractionStrategy
    DocumentExtractionService o--> DocumentExtractionStrategy : mime-keyed registry
    DocumentExtractionStrategy ..> Deadline : checks between steps
    DocumentExtractionStrategy ..> RawLines : returns
    DocumentExtractionService ..> ExtractionResult : cap verdict, one owner
    note for DocumentExtractionService "the single place the character cap is enforced"
    note for PdfExtractionStrategy "the only strategy wired with CleaningKnobs"
```

## Up close — the strategies and the models they trade

```mermaid
classDiagram
    class DocumentExtractionService {
        -registry
        -outputCharLimit
        +extract(data, mime)
    }
    class DocumentExtractionStrategy {
        <<abstract>>
        +extract(data, deadline)
    }
    class PdfExtractionStrategy {
        -knobs: CleaningKnobs
        +extract(data, deadline)
    }
    class DocxExtractionStrategy {
        +extract(data, deadline)
    }
    class TextExtractionStrategy {
        +extract(data, deadline)
    }
    class _Line {
        +text: str
        +y_top: float
        +y_bottom: float
        +alone_in_block: bool
    }
    class Deadline {
        -expires_at: float
        +from_budget(seconds)$
        +expired()
    }
    class RawLines {
        +lines: list
        +partial: bool
    }
    class ExtractionResult {
        +text: str
        +truncated: bool
    }
    class CleaningKnobs {
        +header_repetition_ratio: float
        +repetition_min_pages: int
        +header_edge_zone_ratio: float
        +edge_zone_ratio: float
        +edge_tolerance_ratio: float
        +folio_monotonic_ratio: float
    }
    DocumentExtractionStrategy <|-- PdfExtractionStrategy
    DocumentExtractionStrategy <|-- DocxExtractionStrategy
    DocumentExtractionStrategy <|-- TextExtractionStrategy
    PdfExtractionStrategy o--> CleaningKnobs
    PdfExtractionStrategy ..> _Line : one drawn line, judged in place
    DocumentExtractionStrategy ..> Deadline : carried down as a value
    DocumentExtractionStrategy ..> RawLines : returns
    DocumentExtractionService ..> ExtractionResult : returns
    note for _Line "the PDF parser's whole working vocabulary: y positions are fractions of page height"
    note for Deadline "from_budget starts the monotonic clock; expired is the only check"
    note for RawLines "partial: some document was skipped unreadable, folded into truncated later"
```

The `_Line` four-tuple is rule (a)/(b)'s entire input: what a drawn line says, where it sat on the page, and whether it owned its block — nothing else about a page is kept. `normalize()` is deliberately absent from the shapes above: a plain function, string in / string out, with no state a class diagram could carry (the [cleaning section](#cleaning-the-shared-normalizer) walks its rules).

## Error classes

Two leaves, one base. Both stay generic on the wire — a 504 cannot say which page, a 422 cannot brand the content.

```mermaid
classDiagram
    class ExtractionError
    class BudgetExhaustedError
    class UnreadableDocumentError
    ExtractionError <|-- BudgetExhaustedError
    ExtractionError <|-- UnreadableDocumentError
    note for BudgetExhaustedError "the deadline spent between steps: shaped 504"
    note for UnreadableDocumentError "content that fails after admission: 422, including a gate-registry mismatch"
```

Admission failures never reach here; this family fires only for bytes the gate already admitted.

## Next Steps

- **[Observability](observability.md)** — how each of these outcomes becomes a metric
- **[HTTP reference](../reference/http-api.md)** — the response shapes the cap rule produces
