# Load-test fixture corpus

Deterministic fixture builders plus self-checks for the extraction endpoint.
Generation runs the real pipeline over every valid asset and the real route
over every invalid one, writes observations into `assets/manifest.json`, and
fails loudly on any mismatch — the corpus always describes what the service
actually does.

Everything under `assets/` is generated on demand and gitignored; never
commit the binaries. Regenerate whenever the fixture design or the service
knobs change, and take exact numbers from that run's manifest (deflate byte
count bookkeeping can wobble a little between zlib builds; each manifest
matches its own run).

## Generate

```sh
make load-fixtures                 # or: poetry run python -m tests.load.generate
poetry run python -m tests.load.generate --tier short,mid --format txt
poetry run python -m tests.load.generate --bytes 3145700   # boundary experiments
```

`--tier` filters short/mid/long/oversize/invalid (default all), `--format`
filters txt/docx/pdf (default all), `--bytes` overrides the byte target of
size tiers (minimum 1024; the oversize and invalid tiers ignore it).

## Size tiers

Targets are file sizes; each tier ships one txt, one docx, one pdf.

| tier     | target    | wire answer with every knob at default                  |
| -------- | --------- | ------------------------------------------------------- |
| short    | ~4 KiB    | 200, full text back                                     |
| mid      | ~512 KiB  | 200, full text back                                     |
| long     | ~2.9 MiB  | 200, `truncated: true`, `text_length` exactly 1,000,000 |
| oversize | ~8 MiB    | 413 before sniffing; content stays valid                |

The long tier stays 2 KiB under the 3 MiB body cap so multipart framing
never pushes it past `UPLOAD_LIMIT_BYTES`. Long-tier text exceeds the
default `OUTPUT_CHAR_LIMIT` of 1,000,000 characters by design — the response
is the exact prefix with the flag set, which is the calibration case. The
oversize tier is valid content the bounded read rejects; boot with a raised
`UPLOAD_LIMIT_BYTES` to exercise it as a 200.

Exact bytes, line counts, text lengths, cap flags, and extraction seconds
per file: `assets/manifest.json`.

## Invalid set

Nine tiny files under `assets/invalid/`, each attached to the multipart
field `file` with the declared content type shown:

| file            | declared type          | what is wrong with it                       | status |
| --------------- | ---------------------- | ------------------------------------------- | ------ |
| unknown.bin     | application/octet-stream | legacy OLE magic nothing claims           | 415    |
| imposter.pdf    | application/pdf        | PNG bytes under a pdf name                  | 415    |
| latin1.txt      | text/plain             | non-UTF-8 bytes (txt admission is the decode) | 415   |
| empty-zip.docx  | docx mime              | an empty archive rather than a docx container | 415   |
| dead.pdf        | application/pdf        | pdf signature with no container behind it   | 422    |
| surrogate.docx  | docx mime              | a sound zip whose members are not docx parts | 422   |
| truncated.docx  | docx mime              | a real docx severed mid-record              | 422    |
| broken-xml.docx | docx mime              | a sound container whose body XML explodes   | 422    |
| scanned.pdf     | application/pdf        | structurally valid pdf with no drawn text   | 422    |

Admission-declined uploads answer 415 with the sniffed truth
(`unsupported document type: <mime>`); anything admitted but unextractable
answers 422 with the one generic `corrupt or unsupported upload` detail.
The generator posts all nine through the route and pins their statuses.

## Different-limit boots

The knobs live in `infra/.env` (`UPLOAD_LIMIT_BYTES`,
`PROCESSING_BUDGET_SECONDS`, `OUTPUT_CHAR_LIMIT`). Each asset's tier label
tells you what it should do at the defaults; re-booting with different
limits re-maps them, e.g.:

- `UPLOAD_LIMIT_BYTES=262144` — mid becomes the oversize row (413) and
  short becomes the largest remaining 200.
- `UPLOAD_LIMIT_BYTES=1048576` — long answers 200 with no framing race;
  oversize still 413 until the limit passes ~8 MiB.
- `OUTPUT_CHAR_LIMIT=100000` — the long rows cap at 100,000 instead, so
  `text_length` moves with the knob while `assets/` stays untouched.

`--bytes 3145700` rebuilds a tier right at the wire bound for boundary
shots; route that through the default 3 MiB limit and watch the split
between the fitted size on disk and the arriving multipart body.

## Design notes

- Content comes from one 528-sentence bank (44 bases × 12 reporting
  prefixes) selected by index arithmetic — no RNG, so a tier's text is
  reproducible. Docx bodies are record paragraphs
  (`Record <n> of the archive: ...`), one per paragraph.
- Docx containers use stored deflate blocks (`compresslevel` 0). Prose
  collapses ~20x through zlib's window, so a genuinely deflated multi-MiB
  member would breach admission's own 30 MiB uncompressed bound before the
  file crossed the 3 MiB wire bound; stored members are the shape where
  both bounds stay observable, and both are asserted at build time.
- Pdfs draw on a 612×2400 canvas so multi-MB documents stay under the
  1000-page admission bound, wrap drawn lines at 64 characters so no span
  runs off the page edge, and keep every baseline inside the cleaning-safe
  band.
- The fixture grammar dodges every cleaning rule (no `&<>\()` or terminal
  hyphens, single internal spaces, no page-number-shaped lines), so the
  self-check asserts extraction output equals the fitted text exactly — or
  the exact capped prefix when the text outgrows `OUTPUT_CHAR_LIMIT`.
