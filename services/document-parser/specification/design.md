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
    models.py    # ExtractionResult, typed errors, defaults — leaf
    cleaning.py  # phase-2 normalizer: pure, string-in/string-out
    pdf.py       # pdfium line extraction + rules (a)/(b) — phase-1 owner for PDF
    docx.py      # zip + iterparse, body paragraphs only
    txt.py       # decode; phase 2 only
    service.py   # mime→parser registry; single cap owner (cap + truncated)
    runner.py    # deadline wrapper + executor seam
```

Why parallel to `validation/`: the shape the service already uses — a leaf models.py for shared vocabulary, a registry runner, strategies owning their format. Extraction strategies are keyed by the sniffed mime the admission gate returns; no strategy re-sniffs.

## Runtime model

Why an executor exists at all: in a long-lived runtime (local compose) CPU-bound extraction must not sit on the event loop — probes and other requests stall behind it (NFR-2). On the deployed target each instance serves one request at a time, so the executor is behaviorally a direct call; the seam stays so one code path serves both runtimes.

- The runner submits extraction with the remaining budget, awaits, and on timeout returns the shaped 504 while abandoning the work (soft abandonment, NFR-3).
- **Cooperative deadline**: parsers receive the remaining budget and check it per page / per member chunk (`perf_counter()`). A doomed parse stops ≈ at budget instead of finishing a full 1,000-page loop; the interior caps (1,000 pages, 30 MiB XML, 3 MiB text) guarantee termination regardless.
- ThreadPoolExecutor with a small worker count — exercised by container runs only; Lambda never queues.

## PDF extraction library — pypdfium2

Recorded so the choice survives its authors:

| Option | 1,000-page worst case | Line positions for rules (a)/(b) | License |
|--------|----------------------|----------------------------------|---------|
| pypdf | 10–100 s — the budget is gone before parsing starts | visitor TM/CM matrices, manual line reconstruction | BSD |
| PyMuPDF | fastest | blocks with bbox ready-made | AGPL-3.0 — rejected for a SaaS |
| **pypdfium2** | ~1–3 s (C core; the GIL is released in C land) | TextPage rects = line text + bbox in reading order | Apache-2.0 / BSD-3 |

Admission keeps pypdf: it opens the container for a page count without parsing content — built and tested already. Two libraries, disjoint jobs: pypdf is the bouncer, pdfium is the worker.

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

## Kept as reference

`slop/` stays — the previous build-out is reference material for this one; it is excluded from linting and is not part of the build.
