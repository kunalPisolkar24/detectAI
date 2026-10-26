"""The load-test fixture corpus: deterministic builders plus self-checks.

`python -m tests.load.generate` writes every asset under assets/ from one
fixed sentence bank, indexed by arithmetic and never random, so a tier's
content is reproducible (docx deflate bytes may still differ between zlib
builds; the manifest matches whatever run produced it). The valid tiers
are self-checked through the real admission and extraction pipeline, the
invalid tier through the real route — every observation lands in
manifest.json next to the case's pinned expectation, and a mismatch fails
the generation run loudly. See README.md for the tier contract.
"""

import argparse
import hashlib
import io
import json
import os
import zipfile
from collections.abc import Callable
from pathlib import Path
from time import perf_counter

from app.extraction import build_default_extraction_service
from app.extraction.cleaning import normalize
from app.extraction.models import DEFAULT_OUTPUT_CHAR_LIMIT
from app.validation import build_default_service
from app.validation.models import (
    DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES,
    DEFAULT_UPLOAD_LIMIT_BYTES,
    DOCX_MIME,
    PDF_MIME,
    TEXT_MIME,
)
from tests.support.documents import (
    docx_body_bytes,
    minimal_docx_bytes,
    minimal_pdf_bytes,
    surrogate_zip_bytes,
)

ASSETS = Path(__file__).resolve().parent / "assets"

# Format to the canonical sniffs, named once by the validation models.
_MIMES = {"txt": TEXT_MIME, "docx": DOCX_MIME, "pdf": PDF_MIME}

# Tier byte targets (README.md). long stays 2 KiB under the wire bound so
# the multipart framing never pushes the body past 3 MiB.
_TIER_TARGETS = {"short": 4_096, "mid": 512_000, "long": 2_900_000, "oversize": 8_000_000}
_LONG_WIRE_MARGIN = 2_048
# Every tier's pdf must stay far under admission's 1000-page bound.
_PDF_PAGE_CAP = 900

# The self-check boots the real route with the same pins the integration
# conftest uses (dev flick; the key length satisfies the credential bound).
_SELF_CHECK_KEY = "integration-test-key-001"

_SENTENCE_PREFIXES = (
    "Source records indicate that",
    "The filing states that",
    "Observations confirm that",
    "Archived entries mention that",
    "Store ledgers show that",
    "Compliance notes establish that",
    "Audit trails confirm that",
    "Handbook guidance holds that",
    "Provisioning logs say that",
    "Retention schedules claim that",
    "Support transcripts record that",
    "Planning memos conclude that",
)

_BASE_SENTENCES = (
    "The parser admits bounded uploads through a typed strategy registry",
    "Each strategy sniffs the raw bytes and names the canonical mime.",
    "A declared content type never wins against what the bytes actually are.",
    "The bounded read proves a size breach at the first byte past the cap.",
    "Nothing beyond the limit is ever buffered on the server.",
    "The pipeline computes its deadline once from the configured budget.",
    "Strategies check the clock between pages and member elements.",
    "The largest overshoot is a single page of parse work.",
    "A page that reads cleanly and simply holds no text is not partial.",
    "A repeating drawn header inside the edge zone is deleted on a page share.",
    "Folio shapes track page numbers and trust only a monotonic majority.",
    "Cleaning collapses whitespace runs and drops invisible control bytes.",
    "Hyphens that join words across a line end are stitched back together.",
    "The output cap truncates once and flags the response body.",
    "Extraction returns ordered lines rather than a raw text dump.",
    "Paragraph boundaries survive as the gaps between normalized lines.",
    "Every extraction failure after admission shares one generic detail.",
    "A corrupted upload cannot be branded by name on the wire.",
    "The empty body of a plain text upload is a valid empty result.",
    "Docx paragraphs stream one element deep and clear as they go.",
    "Table nested paragraphs come out in reading order.",
    "Field instructions drop while their rendered results survive.",
    "Legacy word processors still carry tabs and hard breaks verbatim.",
    "The unzip reader trusts metadata sizes before touching content bytes.",
    "Zip bombs are read from the central directory before any extraction.",
    "Admission is signature based, so a renamed container still gets examined.",
    "Inventories and receipts parse the same way as narrative reports.",
    "Invoices carry line items that extraction keeps in document order.",
    "Meeting notes, service bulletins, and contracts extract equally well.",
    "The archive holds scanned contracts, quarterly reports, and memos.",
    "Quarterly reviews summarize margin shifts across every department.",
    "Risk registers list owners, deadlines, and the current mitigation state.",
    "Handover notes record outstanding tickets and their defects.",
    "The monitoring checklist runs after every deployment window.",
    "Release engineers annotate rollout steps and rollback triggers.",
    "Support dashboards surface unresolved incidents by severity.",
    "Data retention follows the compliance schedule per document class.",
    "Backups restore nightly inside the maintenance window.",
    "Capacity planning compares peak traffic against provisioned workers.",
    "Email digests attach agenda items from the shared calendar.",
    "Billing summaries reconcile usage against the provisioning ledger.",
    "The supplier catalog updates prices on the first business day.",
    "Handbook pages describe incident escalation for each region.",
    "Draft feedback cycles close once reviewers sign the transcript",
)

# Composing the bases with varied reporting prefixes multiplies the bank to
# 528 distinct sentences: a repeat cycle far beyond zlib's 32 KiB window,
# so consecutive drawn lines never key identically. The composition strips
# each base's presentation dot before re-adding its own, so joins never
# ship double periods.
_SENTENCES = tuple(
    f"{prefix} {base}." for prefix in _SENTENCE_PREFIXES for base in (raw.removesuffix(".") for raw in _BASE_SENTENCES)
)

# XML- and pdf-literal-unsafe characters, plus rule-4's hyphen line end.
for _sentence in _SENTENCES:
    assert not any(ch in _sentence for ch in "&<>\\()") and not _sentence.endswith("-"), _sentence


def _page_line_sentence(sentence: str) -> bool:
    """True when cleaning rule 5 would swallow this sentence whole-line."""
    return normalize([sentence]) != sentence


assert not any(_page_line_sentence(s) for s in _SENTENCES)


_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# An empty archive's end-of-central-directory record; the \x80+ tail keeps
# utf-8 from claiming the bytes for the text strategy (415 names the zip).
_EMPTY_EOCD = b"PK\x05\x06" + bytes(range(0x80, 0x98))


def _unknown_bin() -> bytes:
    """A legacy OLE compound file: no registry magic in the allow-list and
    utf-8-invalid (decodability is the text strategy's credential, so the
    blob must refuse the decode to stay unclaimed)."""
    return b"\xd0\xcf\x11\xe0" + b"\x00" * 508


def _imposter_pdf() -> bytes:
    """PNG bytes under a pdf name: the declared type must lose the sniff."""
    return _PNG_MAGIC + b"a png renamed to pdf for the sniff experiment " * 12


def _latin1_txt() -> bytes:
    """Latin-1 prose under a txt name: admission IS the strict decode, so
    the registry declines and the 415 names application/octet-stream."""
    return b"plain prose carrying byte soup Caf\xe9 Stra\xdfe M\xfcnchen\xff\xfb that utf-8 must refuse"


def _dead_pdf() -> bytes:
    """A branded signature with no container behind it."""
    return b"%PDF-1.7 no container behind the signature\n" + b"dead tail padding " * 40


def _surrogate_docx() -> bytes:
    """A sound zip whose members are none of the docx parts."""
    return surrogate_zip_bytes(["ppt/presentation.xml", "docProps/core.xml"])


def _truncated_docx() -> bytes:
    """A docx severed mid-record: BadZipFile at admission, never extraction."""
    full = minimal_docx_bytes()
    return full[: len(full) // 2]


def _broken_xml_docx() -> bytes:
    """A sound container whose body XML explodes mid-stream."""
    return docx_body_bytes("<w:p><w:r><w:t>unclosed")


def _scanned_pdf() -> bytes:
    """A structurally valid pdf whose one page draws no text."""
    return minimal_pdf_bytes(1)


# name → (declared multipart type, bytes, expected wire status).
_INVALID_CASES: dict[str, tuple[str, bytes, int]] = {
    "unknown.bin": ("application/octet-stream", _unknown_bin(), 415),
    "imposter.pdf": (PDF_MIME, _imposter_pdf(), 415),
    "latin1.txt": (TEXT_MIME, _latin1_txt(), 415),
    "empty-zip.docx": (DOCX_MIME, _EMPTY_EOCD, 415),
    "dead.pdf": (PDF_MIME, _dead_pdf(), 422),
    "surrogate.docx": (DOCX_MIME, _surrogate_docx(), 422),
    "truncated.docx": (DOCX_MIME, _truncated_docx(), 422),
    "broken-xml.docx": (DOCX_MIME, _broken_xml_docx(), 422),
    "scanned.pdf": (PDF_MIME, _scanned_pdf(), 422),
}

# --- pdf -------------------------------------------------------------------
# A tall 612x2400 canvas: multi-MB text-heavy documents stay under the
# 1000-page admission bound (a letter-height page caps at ~35 drawn lines
# inside the cleaning-safe band). Ops descend 13+ px apart, wider than a
# text line, so every op stays its own drawn block; baselines cover the
# band free of both edge-deletion zones at the spec-default knobs.

_PDF_PAGE_HEIGHT = 2400
_PDF_LINES_PER_PAGE = 104
_TOP_BASELINE = _PDF_PAGE_HEIGHT - 0.21 * _PDF_PAGE_HEIGHT
_BOTTOM_BASELINE = _PDF_PAGE_HEIGHT - 0.79 * _PDF_PAGE_HEIGHT
# 64 chars ≈ 430-512pt of Helvetica 12 from x=72: every drawn line stays
# inside the 612pt canvas, so MuPDF never clips a span (clipping would
# silently shrink the extracted text off the fitted count).
_PDF_LINE_CHARS = 64


def _wrapped(text: str) -> list[str]:
    """Greedy space-bound wraps; each resulting drawn line fits the canvas."""
    lines: list[str] = []
    current = ""
    for word in text.split(" "):
        candidate = f"{current} {word}" if current else word
        if len(candidate) > _PDF_LINE_CHARS and current:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _paragraph(page: int, sentences_per: int) -> str:
    """One joined run of bank sentences, the mapping page-varying so no
    line key repeats on enough pages with one band for rule (a) to fire."""
    return " ".join(_SENTENCES[(page * 7 + item * 5) % len(_SENTENCES)] for item in range(sentences_per))


def _page_ops(page: int) -> list[tuple[float, str]]:
    """One page's drawn lines: a sentence stream wrapped to canvas width,
    baselines descending top to bottom."""
    step = (_TOP_BASELINE - _BOTTOM_BASELINE) / (_PDF_LINES_PER_PAGE - 1)
    segments: list[str] = []
    stream_index = page * 7
    while len(segments) < _PDF_LINES_PER_PAGE:
        block = " ".join(_SENTENCES[(stream_index + 8 * item) % len(_SENTENCES)] for item in range(8))
        segments.extend(_wrapped(block))
        stream_index += 8
    return [(_TOP_BASELINE - line * step, text) for line, text in enumerate(segments[: _PDF_LINES_PER_PAGE])]


def _op_line(baseline: float, text: str) -> str:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"BT /F1 12 Tf 72 {baseline:.2f} Td ({escaped}) Tj ET"


def _pdf_bytes(pages: list[list[tuple[float, str]]]) -> bytes:
    """A structurally valid pdf with positioned text, hand-assembled and
    uncompressed so file size tracks the drawn text (the shape of
    tests.support.documents.positioned_pdf_bytes, taller canvas)."""
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{3 + 2 * item} 0 R' for item in range(len(pages)))}] "
        f"/Count {len(pages)} >>".encode(),
    ]
    for index, page_ops in enumerate(pages):
        content = "\n".join(_op_line(baseline, text) for baseline, text in page_ops)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 {float(_PDF_PAGE_HEIGHT):.0f}] /Contents "
            f"{4 + 2 * index} 0 R /Resources << /Font << /F1 {3 + 2 * len(pages)} 0 R >> >> >>".encode()
        )
        objects.append(f"<< /Length {len(content)} >>\nstream\n{content}\nendstream".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF".encode()
    return bytes(out)


def _pdf_pages_for(target: int, page_cap: int) -> list[list[tuple[float, str]]]:
    """Fit page counts exactly: full pages make the delta arithmetic
    exact, the final page carries the remainder's ops."""
    one_page_ops = _page_ops(0)
    full_ops_bytes = len("\n".join(_op_line(baseline, text) for baseline, text in one_page_ops).encode())
    probe_one = _pdf_bytes([one_page_ops])
    per_page = len(_pdf_bytes([one_page_ops, _page_ops(1)])) - len(probe_one)
    overhead = per_page - full_ops_bytes  # page dict + stream wrapper + xref row
    skeleton = len(probe_one) - per_page  # header + xref + trailer with no pages

    full_pages = min(page_cap, max(0, (target - skeleton) // per_page))
    largest_op = max(len(_op_line(baseline, text)) + 1 for baseline, text in one_page_ops)
    while True:
        remaining = target - skeleton - overhead - full_pages * per_page
        if remaining < largest_op and full_pages > 0:
            full_pages -= 1  # not even one drawn line fits on the tail page
            continue
        break
    # The last page takes ops greedily until the budget stops paying.
    partial: list[tuple[float, str]] = []
    partial_ops = _page_ops(full_pages)
    spent = 0
    for baseline, text in partial_ops:
        cost = len(_op_line(baseline, text)) + 1
        if partial and spent + cost > remaining:
            break
        partial.append((baseline, text))
        spent += cost
    pages = [_page_ops(index) for index in range(full_pages)] + [partial]
    document = _pdf_bytes(pages)
    _assert_band(len(document), max(int(target * 0.90), 1), target, "pdf bytes")
    return pages


def _pdf_document(target: int, page_cap: int) -> tuple[bytes, list[str]]:
    pages = _pdf_pages_for(target, page_cap)
    if len(pages) > page_cap:
        raise SystemExit(f"pdf fit hit the {page_cap}-page cap before {target} bytes")
    lines = [text for page in pages for _, text in page]
    return _pdf_bytes(pages), lines


# --- docx -------------------------------------------------------------------
# Minimal container, body member only (the shape the suite's builders use),
# deflated like a real docx so compressed size is the wire reality and the
# 30 MiB uncompressed admission bound stays checked explicitly.

_DOCUMENT_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:body/>"
    "</w:document>"
)


def _docx_paragraph(index: int) -> str:
    """A record-led paragraph: the ordinal keeps every record unique and
    traceable in the extracted text."""
    return f"Record {index + 1} of the archive: {_paragraph(index, 3)}"


def _deflated_docx(paragraphs: list[str]) -> bytes:
    """A valid docx whose only member is the document body, built with
    stored deflate blocks (compresslevel 0) so the file size IS the
    content size. Plain prose through zlib collapses ~20x inside its
    window, so a real deflated multi-MiB docx would breach admission's
    30 MiB uncompressed bound well before its file crossed the 3 MiB
    wire bound — the two product limits leave no deflated oversize
    member in existence. Stored containers are the shape where both
    bounds stay observable (both are asserted in _docx_document)."""
    runs = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    body = _DOCUMENT_XML.replace("<w:body/>", f"<w:body>{runs}</w:body>")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=0) as container:
        container.writestr("word/document.xml", body)
    return stream.getvalue()


def _docx_document(target: int) -> tuple[bytes, list[str]]:
    """Fit the paragraph count by binary search over the built sizes
    (counts are integer-grained, so a ratio probe alone can overshoot
    the band on the small tiers), then confirm the uncompressed member
    stays inside admission's bound."""
    def build(count: int) -> bytes:
        return _deflated_docx([_docx_paragraph(index) for index in range(count)])

    per_paragraph = len(build(256)) / 256
    low, high = 1, max(1, int(2.0 * target / per_paragraph) + 8)
    while low < high:  # largest count whose deflated document fits the target
        mid = (low + high + 1) // 2
        if len(build(mid)) <= target:
            low = mid
        else:
            high = mid - 1
    document, paragraphs = build(low), [_docx_paragraph(index) for index in range(low)]
    # Stored sizes track the member linearly but paragraphs vary a few
    # percent with their sentence mix, so the floor breathes; the hard
    # caps land in the tier builders (wire bound, admission uncompressed
    # bound) and in the level-0 docstring above.
    _assert_band(len(document), int(target * 0.80), target, "docx bytes")
    tag_overhead = len("<w:p><w:r><w:t>") + len("</w:t></w:r></w:p>")
    uncompressed = (
        sum(len(text) for text in paragraphs)
        + len(paragraphs) * tag_overhead
        + len(_DOCUMENT_XML)
        - len("<w:body/>")
        + len("<w:body></w:body>")
    )
    assert uncompressed < DEFAULT_DOCX_MAX_UNCOMPRESSED_BYTES, (
        f"docx uncompressed size {uncompressed} would breach the admission bound"
    )
    return document, paragraphs


# --- txt --------------------------------------------------------------------

def _txt_document(target: int) -> tuple[bytes, list[str]]:
    """Whole sentences, one per line, chosen greedily to stay under target."""
    lines: list[str] = []
    total = 0
    while True:
        candidate = _SENTENCES[(len(lines) * 3 + (len(lines) // 40) * 7) % len(_SENTENCES)]
        cost = len(candidate) + (1 if lines else 0) + 1  # separator, then the trailing byte
        if total + cost > target:
            break
        lines.append(candidate)
        total += cost
    assert lines, f"no line fits a {target}-byte txt target"
    return ("\n".join(lines) + "\n").encode(), lines


def _assert_band(observed: int, low: int, high: int, label: str) -> None:
    assert low <= observed <= high, f"{label} landed outside the fitted band: {observed} not in [{low}, {high}]"


# --- self-checks -------------------------------------------------------------

def _self_check_extraction(data: bytes, mime: str, expected_text: str, rel: str) -> dict[str, object]:
    """Admission sniffs the canonical mime, then the real pipeline must
    return the fitted text untruncated — or its exact prefix when the
    document outgrows the default output cap (http.md decision 6: the
    flag is the honesty channel, the slice is deterministic). A cleaning
    rule firing or a budget blowout fails generation with the file named."""
    gate = build_default_service()
    outcome = gate.validate(data)
    assert outcome.mime == mime, f"{rel}: admission sniffed {outcome.mime}, expected {mime}"
    started = perf_counter()
    result = build_default_extraction_service().extract(data, outcome.mime)
    duration = perf_counter() - started
    if len(expected_text) > DEFAULT_OUTPUT_CHAR_LIMIT:
        assert result.truncated, f"{rel}: a cap-sized document came back untruncated"
        assert result.text == expected_text[: DEFAULT_OUTPUT_CHAR_LIMIT], f"{rel}: cap slice differs from the fitted lines"
        capped = True
    else:
        assert not result.truncated, f"{rel}: unexpectedly truncated (a cleaning rule fired?)"
        assert result.text == expected_text, f"{rel}: extracted text differs from the fitted lines"
        capped = False
    return {"text_length": len(result.text), "output_capped": capped, "extraction_seconds": round(duration, 3)}


def _self_check_invalid() -> dict[str, dict[str, object]]:
    """Every invalid case materializes under assets/invalid/ (the manual
    Postman pass attaches the same bytes) and then posts through the real
    route; the pinned status and the observed detail land in the manifest
    (a mismatch exits)."""
    from fastapi.testclient import TestClient

    from app.main import app as production_app

    pins = {"ENV_TYPE": "dev", "API_KEY": _SELF_CHECK_KEY}
    saved = {key: os.environ.get(key) for key in pins}
    os.environ.update(pins)
    try:
        observations = {}
        (ASSETS / "invalid").mkdir(exist_ok=True)
        with TestClient(production_app) as client:
            for name, (declared, body, expected) in _INVALID_CASES.items():
                (ASSETS / "invalid" / name).write_bytes(body)
                response = client.post(
                    "/api/v1/extract",
                    headers={"x-api-key": _SELF_CHECK_KEY},
                    files={"file": (name, body, declared)},
                )
                payload = response.json()
                detail = payload["detail"]
                assert response.status_code == expected, (
                    f"invalid/{name}: expected {expected}, observed {response.status_code} {payload}"
                )
                if expected == 415:
                    assert detail.startswith("unsupported document type: "), payload
                else:
                    assert detail == "corrupt or unsupported upload", payload
                observations[f"invalid/{name}"] = {
                    "mime": declared,
                    "bytes": len(body),
                    "sha256": _digest(body),
                    "expected_status": expected,
                    "observed_status": response.status_code,
                    "detail": detail,
                }
        return observations
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


# --- assembly ----------------------------------------------------------------

def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


_BUILDERS: dict[str, Callable[[int], tuple[bytes, list[str]]]] = {
    "txt": _txt_document,
    "docx": _docx_document,
    "pdf": lambda size: _pdf_document(size, _PDF_PAGE_CAP),
}


def _build_size_tier(tier: str, target: int, formats: set[str]) -> dict[str, dict[str, object]]:
    """Write one size tier's assets and return their manifest entries."""
    wire_cap = (DEFAULT_UPLOAD_LIMIT_BYTES - _LONG_WIRE_MARGIN) if tier == "long" else None
    entries: dict[str, dict[str, object]] = {}
    for format_name in sorted(formats):
        data, lines = _BUILDERS[format_name](target)
        rel = f"{tier}.{format_name}"
        if wire_cap is not None:
            assert len(data) <= wire_cap, (
                f"{rel}: {len(data)} bytes would breach the wire bound minus framing margin"
            )
        if len(data) >= DEFAULT_UPLOAD_LIMIT_BYTES:
            raise SystemExit(f"{rel}: {len(data)} bytes already 413s at the default wire bound")
        checks: dict[str, object] = {
            "tier": tier,
            "target_bytes": target,
            "bytes": len(data),
            "sha256": _digest(data),
        }
        checks.update(_self_check_extraction(data, _MIMES[format_name], "\n".join(lines), rel))
        checks["lines"] = len(lines)
        (ASSETS / rel).write_bytes(data)
        entries[rel] = checks
    return entries


def _build_oversize(target: int, formats: set[str]) -> dict[str, dict[str, object]]:
    """Oversize assets are valid documents the wire bound rejects, so the
    extraction self-check would only burn budget on a guaranteed 413 —
    the entry records that and skips the pipeline."""
    entries: dict[str, dict[str, object]] = {}
    for format_name in sorted(formats):
        data, lines = _BUILDERS[format_name](target)
        rel = f"oversize.{format_name}"
        assert len(data) > DEFAULT_UPLOAD_LIMIT_BYTES, f"{rel}: {len(data)} does not cross the wire bound it exists to cross"
        entry: dict[str, object] = {
            "tier": "oversize",
            "mime": _MIMES[format_name],
            "target_bytes": target,
            "bytes": len(data),
            "sha256": _digest(data),
            "lines": len(lines),
            "expected_status": 413,
            "note": "the bounded read answers before a sniff; content stays valid for raised-limit boots",
        }
        (ASSETS / rel).write_bytes(data)
        entries[rel] = entry
    return entries


def _build_all(tiers: list[str], formats: set[str], override: int | None) -> dict[str, dict[str, object]]:
    """Every requested asset, written and self-checked; the manifest is
    dropped first so a failed run never leaves a stale index lying."""
    manifest_path = ASSETS / "manifest.json"
    if manifest_path.exists():
        manifest_path.unlink()
    manifest: dict[str, dict[str, object]] = {}
    if "invalid" in tiers:
        manifest.update(_self_check_invalid())
    for tier in (tier for tier in tiers if tier != "invalid"):
        target = override if override is not None else _TIER_TARGETS[tier]
        if tier == "oversize":
            manifest.update(_build_oversize(target, formats))
        else:
            manifest.update(_build_size_tier(tier, target, formats))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate the load-test fixture corpus with self-checks (see tests/load/README.md)."
    )
    parser.add_argument(
        "--tier",
        default="short,mid,long,oversize,invalid",
        help="comma list of short,mid,long,oversize,invalid (default: all)",
    )
    parser.add_argument("--format", default="txt,docx,pdf", help="comma list of txt,docx,pdf size tiers (default: all)")
    parser.add_argument(
        "--bytes",
        type=int,
        default=None,
        help="override size-tier byte targets (boundary experiments; invalid tier unaffected)",
    )
    args = parser.parse_args()
    tiers = [tier.strip() for tier in args.tier.split(",") if tier.strip()]
    known_tiers = {*_TIER_TARGETS, "invalid"}
    unknown = set(tiers) - known_tiers
    assert not unknown, f"unknown tiers {sorted(unknown)}; known: {sorted(known_tiers)}"
    formats = {fmt.strip() for fmt in args.format.split(",") if fmt.strip()}
    unknown = formats - set(_MIMES)
    assert not unknown, f"unknown formats {sorted(unknown)}; known: {sorted(_MIMES)}"
    if args.bytes is not None:
        assert args.bytes >= 1_024, "--bytes must stay at least 1024 so every fit can place content"
        if "invalid" in tiers:
            print("note: --bytes never applies to the invalid tier; generating it unaffected")

    ASSETS.mkdir(parents=True, exist_ok=True)
    manifest = _build_all(tiers, formats, args.bytes)
    (ASSETS / "manifest.json").write_text(
        json.dumps({"wire_bound_bytes": DEFAULT_UPLOAD_LIMIT_BYTES, "files": dict(sorted(manifest.items()))}, indent=2, sort_keys=True)
        + "\n"
    )
    print(f"wrote {len(manifest)} assets + manifest.json under {ASSETS}")


if __name__ == "__main__":
    main()



