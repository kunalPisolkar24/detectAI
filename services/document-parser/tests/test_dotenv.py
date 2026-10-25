"""DotEnvAdapter against tmp-path planes: parsing quirks, absent-file
loudness, and dict-like lookups — the behaviors python-dotenv guarantees
and the adapter adds (parse-once, typed errors, copy safety).
"""

from pathlib import Path

import pytest

from app.config.adapters.dotenv import DotEnvAdapter, DotEnvError


def _plane(tmp_path: Path, lines: list[str]) -> Path:
    path = tmp_path / ".env"
    path.write_text("\n".join(lines) + "\n")
    return path


def test_fetch_parses_the_plane_exactly_as_written(tmp_path: Path) -> None:
    adapter = DotEnvAdapter(
        _plane(
            tmp_path,
            [
                "API_KEY=plain-value",
                'QUOTED="hi # there"',
                "STATED=1 # inline note",
                "export EXPORTED=2",
                "EMPTY=",
            ],
        )
    )

    values = adapter.fetch()
    assert values["API_KEY"] == "plain-value"
    assert values["QUOTED"] == "hi # there"
    assert values["STATED"] == "1"
    assert values["EXPORTED"] == "2"
    assert values["EMPTY"] == ""


def test_bare_keys_without_a_value_are_dropped(tmp_path: Path) -> None:
    adapter = DotEnvAdapter(_plane(tmp_path, ["BARE", "KEPT=1"]))

    assert "BARE" not in adapter.fetch()
    assert adapter.get("KEPT") == "1"


def test_missing_plane_fails_loud_with_the_fix(tmp_path: Path) -> None:
    with pytest.raises(DotEnvError, match=" infra/.env") as excinfo:
        DotEnvAdapter(tmp_path / "infra" / ".env")
    assert "make env" in str(excinfo.value)


def test_get_without_default_answers_none(tmp_path: Path) -> None:
    adapter = DotEnvAdapter(_plane(tmp_path, ["A=1"]))

    assert adapter.get("A") == "1"
    assert adapter.get("MISSING") is None


def test_get_prefers_the_callers_default(tmp_path: Path) -> None:
    adapter = DotEnvAdapter(_plane(tmp_path, []))

    assert adapter.get("MISSING", "fallback") == "fallback"
    assert adapter.get("MISSING") is None


def test_fetch_returns_a_copy_independent_of_the_cache(tmp_path: Path) -> None:
    adapter = DotEnvAdapter(_plane(tmp_path, ["A=1"]))

    first = adapter.fetch()
    first["A"] = "poisoned"
    first["INJECTED"] = "poisoned"

    assert adapter.fetch()["A"] == "1"
    assert "INJECTED" not in adapter.fetch()
    assert adapter.get("A") == "1"
