"""DOCX extraction: the zip's single body part, streamed, not loaded."""

import io
import zipfile
from collections.abc import Iterator
from xml.etree import ElementTree

from ..models import BudgetExhaustedError, Deadline, RawLines, UnreadableDocumentError
from .base import DocumentExtractionStrategy

_DOCUMENT_PART = "word/document.xml"
_FIELD_INSTRUCTION = "instruction"
_FIELD_RESULT = "result"


class DocxExtractionStrategy(DocumentExtractionStrategy):
    """Extracts the body paragraphs of an admitted docx.

    zipfile opens the bounded bytes and ElementTree.iterparse streams
    the body member — no python-docx — emitting one raw line per
    paragraph in document order. Only the body part is ever read:
    headers, footers, and footnotes live in other members. Legacy field
    runs are the walk's one phase-1 job (cleaning.md): the instruction
    between a field's begin and its separator is dropped, the rendered
    result after the separator survives, and the markers themselves
    never emit. Table-nested paragraphs are body content and come out
    in reading order. expired() is checked between member elements,
    a body part with no text paragraphs is a valid empty result, and
    every failure after admission is UnreadableDocumentError.
    """

    def extract(self, data: bytes, deadline: Deadline) -> RawLines:
        try:
            with (
                zipfile.ZipFile(io.BytesIO(data)) as container,
                container.open(_DOCUMENT_PART) as body,
            ):
                lines = list(self._body_lines(body, deadline))
        except (zipfile.BadZipFile, OSError, ElementTree.ParseError, KeyError) as error:
            raise UnreadableDocumentError("the docx body part would not stream") from error
        return RawLines(lines, partial=False)

    def _body_lines(self, body: object, deadline: Deadline) -> Iterator[str]:
        """The body's text paragraphs as raw lines: the parsed tree is
        only ever held one paragraph deep, and each paragraph is
        cleared so its memory leaves with the label."""
        for _, paragraph in ElementTree.iterparse(body, events=("end",)):
            if _localname(paragraph) != "p":
                continue
            if deadline.expired():
                raise BudgetExhaustedError("the budget was spent between member elements")
            text = _paragraph_text(paragraph)
            paragraph.clear()
            if text.strip():
                yield text


def _paragraph_text(paragraph: ElementTree.Element) -> str:
    """One paragraph's raw text: run text, tabs, and breaks verbatim;
    field instructions dropped, field results kept."""
    parts: list[str] = []
    field_state: str | None = None
    for node in paragraph.iter():
        name = _localname(node)
        if name == "fldChar":
            field_state = _after_field_char(node)
        elif name == "instrText":
            continue
        elif name in ("t", "tab", "br") and field_state != _FIELD_INSTRUCTION:
            parts.append({"t": node.text or "", "tab": "\t", "br": "\n"}[name])
    return "".join(parts)


def _after_field_char(node: ElementTree.Element) -> str | None:
    """The walk state a field-char element leaves behind: instruction
    after a begin (or any unrecognized kind — a safe fail into silence),
    result after a separator, None after the end."""
    kind = _attr(node, "fldCharType")
    if kind == "separate":
        return _FIELD_RESULT
    if kind == "end":
        return None
    return _FIELD_INSTRUCTION


def _localname(element: ElementTree.Element) -> str:
    """The tag after the namespace URI: namespaced documents, renamed
    prefixes, and bare local names all reduce to the same key."""
    return element.tag.rpartition("}")[2]


def _attr(element: ElementTree.Element, name: str) -> str:
    """The first attribute whose localname matches `name`; attributes
    ride the wordprocessingml namespace like elements do."""
    for key, value in element.attrib.items():
        if key.rpartition("}")[2] == name:
            return value
    return ""
