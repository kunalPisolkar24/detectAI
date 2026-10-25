"""The phase-2 normalizer (cleaning.md): one shared, ordered,
string-in/string-out pass over the strategies' raw lines — owned by the
pipeline, never run inside a strategy.

The rules run once in cleaning.md's order and none are skippable.
"""

import re
from collections.abc import Sequence

# Rule 1: every line-ending convention becomes LF.
_LINE_ENDING = re.compile(r"\r\n|[\r\u2028\u2029]")
# Rule 2: the control and invisible drops (cleaning.md); the tab is in
# no range — it rides to rule 6 as whitespace.
_INVISIBLE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200d\u2060\ufeff\xad]")
# Rule 4: a hyphen joins across a line break only when word characters
# flank the joint.
_HYPHEN_BREAK = re.compile(r"(?<=\w)-\n(?=\w)")
# Rule 5: the two folio shapes, matched whole-line (trimmed) and
# case-insensitive for the Page N of M form.
_PAGE_LINE = re.compile(r"(?:page\s+\d+\s+of\s+\d+|-\s*\d+\s*-)", re.IGNORECASE)
# Rule 6: space/tab run collapse, then paragraph-break collapse.
_SPACE_RUN = re.compile(r"[ \t]+")
_BLANK_RUN = re.compile(r"\n{3,}")


def normalize(lines: Sequence[str]) -> str:
    """The ordered phase-2 rules for raw ordered lines (cleaning.md)."""
    text = _LINE_ENDING.sub("\n", "\n".join(lines))
    text = _INVISIBLE.sub("", text)
    text = text.replace("\xa0", " ")
    text = _HYPHEN_BREAK.sub("", text)
    text = "\n".join(line for line in text.split("\n") if not _is_page_line(line))
    text = "\n".join(_SPACE_RUN.sub(" ", line).strip() for line in text.split("\n"))
    return _BLANK_RUN.sub("\n\n", text).strip()


def _is_page_line(line: str) -> bool:
    """Rule 5's whole-line verdict on a trimmed line (cleaning.md)."""
    return _PAGE_LINE.fullmatch(line.strip()) is not None
