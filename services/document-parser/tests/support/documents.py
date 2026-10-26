"""In-memory document builders for both test trees.

The strategies now open containers, so tests need *real* documents, not
magic-prefix bytes: one blank-page pdf via pypdf's writer, zip-assembled
docx bodies (bare, paragraphed, or raw-XML crafted), and a zip impostor
that deliberately does not. Sizes stay tiny on purpose — the strategies
accept bounds as parameters, so oversized behavior is tested through
injected small limits rather than materialized gigabytes.
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
    """A structurally valid pdf of `pages` blank pages."""
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


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
