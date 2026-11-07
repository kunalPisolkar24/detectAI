"""Parsing the values .env file."""

from __future__ import annotations

import re
from pathlib import Path


def parse_env_file(path: Path) -> dict[str, str]:
    """KEY=value parser: strips inline comments, keeps the first duplicate."""
    values: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = re.sub(r"\s+#.*$", "", value).strip()
        if not key:
            print(f"warning: {path.name}:{lineno}: empty key before '='; skipped")
            continue
        if key in values:
            print(f"warning: {path.name}:{lineno}: duplicate {key}; keeping the first")
            continue
        values[key] = value
    return values
