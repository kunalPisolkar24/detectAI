"""Reading declarations from TOML, with whole table blocks that can be commented out."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

_HEADER = r"\[\[[^\]\n\",]+\]\]|\[[^\]\n\",]+\]"
_COMMENTED_HEADER_RE = re.compile(rf"^\s*#\s*({_HEADER})\s*(?:#.*)?$")
_HEADER_RE = re.compile(rf"^\s*({_HEADER})\s*(?:#.*)?$")


def _line_ending(line: str) -> str:
    if line.endswith("\r\n"):
        return "\r\n"
    if line.endswith(("\n", "\r")):
        return line[-1]
    return ""


def _active_text(text: str) -> str:
    """Blank commented-out blocks; blanking keeps tomllib error line numbers aligned with the file."""
    lines: list[str] = []
    disabled = False
    for line in text.splitlines(keepends=True):
        if _COMMENTED_HEADER_RE.match(line):
            disabled = True
            lines.append(_line_ending(line))
        elif _HEADER_RE.match(line):
            disabled = False
            lines.append(line)
        elif disabled:
            lines.append(_line_ending(line))
        else:
            lines.append(line)
    return "".join(lines)


def parse_declaration(path: Path) -> dict:
    return tomllib.loads(_active_text(path.read_text()))
