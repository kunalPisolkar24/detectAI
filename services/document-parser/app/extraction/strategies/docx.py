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
    """Only the body part is ever read; legacy field runs drop instructions, keep results."""

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
        """The tree is held one paragraph deep; clear() frees each as it leaves."""
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
    """Unrecognized kinds fall into instruction state — safe silence."""
    kind = _attr(node, "fldCharType")
    if kind == "separate":
        return _FIELD_RESULT
    if kind == "end":
        return None
    return _FIELD_INSTRUCTION


def _localname(element: ElementTree.Element) -> str:
    return element.tag.rpartition("}")[2]


def _attr(element: ElementTree.Element, name: str) -> str:
    for key, value in element.attrib.items():
        if key.rpartition("}")[2] == name:
            return value
    return ""
