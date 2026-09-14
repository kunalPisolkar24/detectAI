import re
from pathlib import Path

from src.core.exceptions import EnvParseError

_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _strip_inline_comment(value: str) -> str:
    """Remove trailing `# comment` not inside quotes."""
    in_single = False
    in_double = False
    for i, ch in enumerate(value):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            if i == 0 or value[i - 1] != "\\":
                in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            # only treat as comment if preceded by whitespace or at start
            if i == 0 or value[i - 1].isspace():
                return value[:i].rstrip()
    return value


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        inner = value[1:-1]
        if value[0] == '"':
            # handle escaped quotes and \n etc minimally
            inner = inner.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")
        return inner
    return value


def parse_env_file(path: str | Path) -> dict[str, str]:
    """Parse a dotenv file robustly.

    Handles: export prefix, quoted values, spaces around '=', inline # comments.
    Never raises on missing file — caller decides.
    """
    p = Path(path)
    if not p.exists():
        raise EnvParseError(f"env file not found: {p}")

    data: dict[str, str] = {}
    with p.open("r", encoding="utf-8") as f:
        for lineno, raw in enumerate(f, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            # handle `export KEY=val`
            if line.startswith("export "):
                line = line[len("export ") :].lstrip()
                if not line or line.startswith("#"):
                    continue
            if "=" not in line:
                continue  # ignore malformed line, e.g. shell comments
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key or not _KEY_RE.match(key):
                continue
            # strip inline comment before unquoting (quoted # stays)
            if value and not (value.startswith('"') or value.startswith("'")):
                value = _strip_inline_comment(value)
            else:
                # for quoted values, keep inner # but strip trailing comment after closing quote
                # e.g. KEY="val" # comment
                if len(value) >= 2 and value[0] in ('"', "'"):
                    q = value[0]
                    # trim comment after quoted part if any
                    if value.count(q) >= 2:
                        last_q = value.rfind(q)
                        remainder = value[last_q + 1 :].strip()
                        if remainder.startswith("#"):
                            value = value[: last_q + 1]
                value = value.strip()

            value = value.strip()
            # remove surrounding quotes
            value = _unquote(value)
            # final strip: treat `KEY= "val"` -> value was `"val"` with leading space already stripped above,
            # but also `KEY= value` with leading space already stripped via value.strip()
            data[key] = value
    return data
