"""In-memory document builders for both test trees.

The strategies now open containers, so tests need *real* documents, not
magic-prefix bytes: one blank-page pdf via pypdf's writer, hand-built
positioned-text pdfs for the coordinate rules (singletons and merged
multi-line blocks deliberately), zip-assembled docx bodies (bare,
paragraphed, or raw-XML crafted), and a zip impostor that deliberately
does not. Sizes stay tiny on purpose — the strategies accept bounds as
parameters, so oversized behavior is tested through injected small
limits rather than materialized gigabytes.
"""

import io
import zipfile
from collections.abc import Sequence

from pypdf import PdfWriter

_DOCUMENT_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:body/>"
    "</w:document>"
)


def minimal_pdf_bytes(pages: int = 1) -> bytes:
    """A structurally valid pdf of `pages` blank pages — the shape whose
    extraction verdict is the scanned-422 case. The 612x792 canvas
    matches positioned-pdf pages, so the rel-zone maths read the same.
    """
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=612, height=792)
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


def positioned_pdf_bytes(pages: Sequence[Sequence[tuple[float, str]]]) -> bytes:
    """A structurally valid pdf with positioned text: one drawn line per
    (baseline, text) pair, the baseline measured from the page's bottom
    edge (PDF coordinates, a 612x792 page). Each `BT...ET` op becomes
    its own drawn block unless two ops sit within one line height of
    each other — the merger is deliberate: it exercises the strategy's
    single-line gate. Zero dependencies: containers and xref offsets
    are computed by hand, so the fixtures double as byte-stable probes
    of pymupdf's block grouping.
    """
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{' '.join(f'{3 + 2 * item} 0 R' for item in range(len(pages)))}] "
        f"/Count {len(pages)} >>".encode(),
    ]
    for index, page_ops in enumerate(pages):
        content = "\n".join(
            f"BT /F1 12 Tf 72 {float(baseline):.2f} Td ({_pdf_literal(text)}) Tj ET"
            for baseline, text in page_ops
        ).encode()
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents "
            f"{4 + 2 * index} 0 R /Resources << /Font << /F1 {3 + 2 * len(pages)} 0 R >> >> >>".encode()
        )
        objects.append(
            f"<< /Length {len(content)} >>\nstream\n{content.decode()}\nendstream".encode()
        )
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{index} 0 obj\n".encode() + body + b"\nendobj\n"
    xref_at = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode() + b"0000000000 65535 f \n"
    out += "".join(f"{offset:010d} 00000 n \n" for offset in offsets).encode()
    out += (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF".encode()
    )
    return bytes(out)


def _pdf_literal(text: str) -> str:
    """Escape a fixture string for a pdf literal: the backslash and the
    parentheses are the Tj string's metacharacters."""
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def minimal_docx_bytes(parts: dict[str, bytes] | None = None) -> bytes:
    """A structurally valid docx: its body part, plus any extra members."""
    return _zip_of({"word/document.xml": _DOCUMENT_XML, **(parts or {})})


def docx_body_bytes(inner: str) -> bytes:
    """A docx whose body part carries `inner` as the body's children —
    raw XML, so tests can craft paragraphs, tabs, breaks, and fields
    exactly, including malformed input."""
    body = _DOCUMENT_XML.replace("<w:body/>", f"<w:body>{inner}</w:body>")
    return _zip_of({"word/document.xml": body})


def paragraphed_docx_bytes(paragraphs: Sequence[str]) -> bytes:
    """A docx with one plain-text paragraph per given string."""
    runs = "".join(f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p>" for text in paragraphs)
    return docx_body_bytes(runs)


def surrogate_zip_bytes(names: list[str], payload: bytes = b"x") -> bytes:
    """A zip archive that carries none of the docx body parts, for cases
    where PK-headered bytes must not pass for a document."""
    return _zip_of({name: payload for name in names})


def _zip_of(members: dict[str, str | bytes]) -> bytes:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as container:
        for name, content in members.items():
            container.writestr(name, content)
    return stream.getvalue()
