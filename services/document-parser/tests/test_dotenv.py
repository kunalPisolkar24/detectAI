"""DotEnvAdapter against tmp-path planes: parsing quirks, path resolution
(explicit paths fail loud, the untouched default may be absent), and
dict-like lookups — the behaviors python-dotenv guarantees and the adapter
adds (parse-once, typed errors, copy safety).
"""

from pathlib import Path

import pytest

from app.config.adapters import dotenv as dotenv_module
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


def test_missing_explicit_plane_fails_loud_with_the_fix(tmp_path: Path) -> None:
    missing = tmp_path / "infra" / ".env"
    with pytest.raises(DotEnvError) as excinfo:
        DotEnvAdapter(missing)
    assert str(missing) in str(excinfo.value)
    assert "make env" in str(excinfo.value)


def test_default_path_without_a_file_is_an_empty_plane(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(dotenv_module.DOTENV_PATH_VAR, raising=False)
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", tmp_path / "absent" / ".env")

    adapter = DotEnvAdapter()

    assert adapter.fetch() == {}
    assert adapter.get("A") is None


def test_default_resolution_ignores_the_working_directory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(dotenv_module.DOTENV_PATH_VAR, raising=False)
    grounded = tmp_path / "grounded"
    grounded.mkdir()
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", _plane(grounded, ["A=1"]))
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    monkeypatch.chdir(elsewhere)  # no plane at the CWD; the anchored path must still answer

    assert DotEnvAdapter().get("A") == "1"


def test_default_path_is_the_package_anchored_infra_env() -> None:
    expected = Path(dotenv_module.__file__).resolve().parents[3] / "infra" / ".env"

    assert dotenv_module._DEFAULT_DOTENV_PATH == expected


def test_env_override_supplies_the_plane(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    plane = _plane(tmp_path, ["A=1"])
    monkeypatch.setenv(dotenv_module.DOTENV_PATH_VAR, str(plane))

    assert DotEnvAdapter().get("A") == "1"


def test_env_override_without_a_plane_fails_loud_with_its_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    missing = tmp_path / "custom" / ".env"
    monkeypatch.setenv(dotenv_module.DOTENV_PATH_VAR, str(missing))

    with pytest.raises(DotEnvError) as excinfo:
        DotEnvAdapter()
    assert str(missing) in str(excinfo.value)


def test_env_override_pointing_at_a_directory_fails_loud(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    directory = tmp_path / "plane"
    directory.mkdir()
    monkeypatch.setenv(dotenv_module.DOTENV_PATH_VAR, str(directory))

    with pytest.raises(DotEnvError, match="not a file"):
        DotEnvAdapter()


def test_blank_env_override_falls_back_to_the_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    grounded = tmp_path / "grounded"
    grounded.mkdir()
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", _plane(grounded, ["A=1"]))
    monkeypatch.setenv(dotenv_module.DOTENV_PATH_VAR, "   ")  # blank is not a path

    assert DotEnvAdapter().get("A") == "1"


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
