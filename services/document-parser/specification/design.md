# Document Parser — Design

Module layout, runtime model, and the decisions behind them. Requirements live in [requirements.md](requirements.md); the wire contract in [http.md](http.md); text fidelity in [cleaning.md](cleaning.md).

Status: drafted with the Lambda target decision. The load/e2e rig is deferred and not designed here.

## Module layout

```
app/
  config/        # planes, settings contract, factories (built)
  validation/    # admission gate: strategies + typed rejections (built)
  api/           # auth guard, transport gate, extract route (built; route grows the last leg)
  extraction/    # this build
    models.py    # Deadline, ExtractionResult, typed verdicts, defaults — leaf
    cleaning.py  # phase-2 normalizer: pure, string-in/string-out
    service.py   # mime-keyed registry + the pipeline; single cap owner (cap + truncated)
    strategies/  # one module per sniffed MIME; base.py holds the seam
      pdf.py     # pymupdf block walk + rules (a)/(b) — phase-1 owner for PDF
      docx.py    # zip + iterparse, body paragraphs only
      text.py    # strict decode; phase 2 only
```

Why parallel to `validation/`: the shape the service already uses — a leaf models.py for shared vocabulary, a registry service that owns the pipeline, strategies owning their format. Extraction strategies are keyed by the sniffed mime the admission gate returns; no strategy re-sniffs. The deadline wrapper the layout once imagined as `runner.py` folds into service.py — it computes the Deadline in extract() and carries it down as a value.

## Runtime model

There is **no executor and no worker pool — anywhere**. Extraction is a direct synchronous call on the event loop in prod, in compose, and in tests; concurrency is provided outside the process — Lambda instances, and for a container target: replicas, not threads. Compose's serialization behind an in-flight parse is the test rig's business, not the app's.

- **Cooperative deadline**: the pipeline computes the `Deadline` once from the settings budget, and strategies check it between pages / member elements (`perf_counter()`). A doomed parse stops ≈ at budget instead of finishing a full 1,000-page loop, and the raise *is* the shaped 504 — self-abandonment, with no worker ever finishing alone (NFR-3).
- The largest possible overshoot past the budget is one page or one member element; the timeout stack backstops whatever a step itself might stall on — function timeout 12 s above the in-code budget 10 s, API GW integration above both (NFR-3c).
- The interior caps (1,000 pages, 30 MiB XML, 3 MiB text) guarantee termination regardless — with no executor to abandon into, they are the only guarantee.

## PDF extraction library — PyMuPDF v2

Recorded so the choice survives its authors — including this reversal of it:

| Option | 1,000-page worst case | Line positions for rules (a)/(b) | License |
|--------|----------------------|----------------------------------|---------|
| pypdf | 10–100 s — the budget is gone before parsing starts | visitor TM/CM matrices, manual line reconstruction | BSD |
| **PyMuPDF v2** | fastest | blocks with bbox ready-made | AGPL-3.0 — accepted (the why below) |
| pypdfium2 | ~1–3 s (C core; the GIL is released in C land) | TextPage rects = line text + bbox in reading order | Apache-2.0 / BSD-3 |

pypdfium2 was the earlier pick on license grounds; PyMuPDF v2 replaced it because extraction wants the blocks-with-coordinates shape mupdf groups natively, and pypdfium2's TextPage would re-derive it line by line. The AGPL reversal holds in the current deployment: the parser sits behind detectAI's own API key and serves no network users, so AGPL obligations do not reach outward; if a network-facing use ever arrives, the path is Artifex's commercial license and the strategy seam keeps that a one-module swap. Pin `^2.0` and `import pymupdf` — never the legacy `fitz` alias.

Admission keeps pypdf, strict and behavior-tested; mupdf's leniency must not move the 415/422 surface. Two libraries, disjoint jobs: pypdf is the bouncer, PyMuPDF is the worker.

Rule (b)'s "single-line block" test needs lines grouped into blocks by y-proximity; the grouping happens inside the PDF parser's extraction pass, not as a separate stage.

## Packaging (Lambda)

- **Container image via Lambda Web Adapter** — the app, config planes, and tests stay unmodified; the same image serves local compose and Lambda. Mangum was rejected: it rewrites the app onto event objects, diverging the tested surface from the deployed surface.
- **Memory ≥ 1,769 MB (1 vCPU)** — CPU scales with memory on Lambda; below this the 1,000-page worst case falls out of the 10 s budget. Operational detail — lives in requirements.md's Deployment target.
- **Timeout stack**: function timeout 12 s > in-code budget 10 s; API Gateway integration timeout above both (see http.md).

## Testing strategy

- **Unit**: the phase-2 corpus ported from the old rule-list cases (control chars, hyphen rejoin, blank collapse); cleaning.md's anchors for rules (a)/(b) — boundary ratios, digit-normalized keys, pure-digit exclusion, few candidates, restarted numbering; DOCX body-only + field-char remnants; cap/truncated single ownership.
- **Fixtures**: positioned-text PDFs are hand-crafted content streams (tiny PDFs with `Tm` operators) — no new test dependencies.
- **Integration**: the extract endpoint's full path matrix (401/413/415/422/200/504).
- **Deferred**: load rig port and e2e updates (container-runtime concern; user decision).

## Removed reference material

The previous build-out (`slop/`) was kept as reference material while this one
was built; it is now removed. The complete copy is recoverable from git
history.
