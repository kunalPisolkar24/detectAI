"""In-memory document builders for both test trees.

The strategies now open containers, so tests need *real* documents, not
magic-prefix bytes: one blank-page pdf via pypdf's writer, a small
zip-assembled docx that always carries its body part, and a zip impostor
that deliberately does not. Sizes stay tiny on purpose — the strategies
accept bounds as parameters, so oversized behavior is tested through
injected small limits rather than materialized gigabytes.
"""

import io
import zipfile

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
