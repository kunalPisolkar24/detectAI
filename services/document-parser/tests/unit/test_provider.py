"""The ConfigProvider planes: dev answers from the process environment over
the dotenv file, prod from the two AWS planes with the disjointness
contract, and require() names key and plane on a missing mandatory value.
"""

from pathlib import Path

import pytest

from app.config.adapters import dotenv as dotenv_module
from app.config.adapters.dotenv import DotEnvAdapter
from app.config.errors import ConfigError
from app.config.provider import DevConfig, ProdConfig


class FakeAdapter:
    """Stands in for a constructed AWS adapter: ProdConfig only calls fetch()."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = values

    def fetch(self) -> dict[str, str]:
        return dict(self._values)


def test_dev_plane_prefers_process_env_over_the_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("API_KEY", "env-key-16-chars")
    provider = DevConfig(DotEnvAdapter(_plane(tmp_path, ["API_KEY=file-key-16-chars"])))

    assert provider.get("API_KEY") == "env-key-16-chars"


def test_dev_plane_falls_back_to_the_file_without_a_matching_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("API_KEY", raising=False)
    provider = DevConfig(DotEnvAdapter(_plane(tmp_path, ["API_KEY=file-key-16-chars"])))

    assert provider.get("API_KEY") == "file-key-16-chars"


def test_dev_plane_works_off_a_fileless_container(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(dotenv_module.DOTENV_PATH_VAR, raising=False)
    monkeypatch.setattr(dotenv_module, "_DEFAULT_DOTENV_PATH", tmp_path / "absent" / ".env")
    monkeypatch.setenv("API_KEY", "env-key-16-chars")

    provider = DevConfig(DotEnvAdapter())

    assert provider.get("API_KEY") == "env-key-16-chars"


def test_dev_plane_get_answers_none_when_the_key_is_seeded_nowhere(tmp_path: Path) -> None:
    provider = DevConfig(DotEnvAdapter(_plane(tmp_path, ["API_KEY=file-key-16-chars"])))

    assert provider.get("MISSING") is None
    assert provider.get("MISSING", "fallback") == "fallback"


def test_prod_plane_answers_from_both_aws_planes() -> None:
    provider = ProdConfig(FakeAdapter({"MAX_PDF_PAGES": "1000"}), FakeAdapter({"API_KEY": "prod-key-16-chars"}))

    assert provider.get("API_KEY") == "prod-key-16-chars"
    assert provider.get("MAX_PDF_PAGES") == "1000"


def test_prod_plane_overlap_fails_loud_regardless_of_case() -> None:
    # A lowercase SSM seed must collide with the upper-snake blob key: the
    # case-folded check is what stops a re-seeded API_KEY from silently
    # becoming config through the bridge.
    with pytest.raises(ConfigError, match="api_key") as excinfo:
        ProdConfig(FakeAdapter({"api_key": "d" * 20}), FakeAdapter({"API_KEY": "c" * 20}))
    assert "secrets-apply" in str(excinfo.value)


def _plane(tmp_path: Path, lines: list[str]) -> Path:
    path = tmp_path / ".env"
    path.write_text("\n".join(lines) + "\n")
    return path
