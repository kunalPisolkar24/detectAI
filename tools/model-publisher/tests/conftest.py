"""Shared fixtures for model-publisher tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from src.infrastructure.config.provider import clear_settings_cache


@pytest.fixture(autouse=True)
def _clear_settings_between_tests() -> None:
    clear_settings_cache()
    yield
    clear_settings_cache()


@pytest.fixture()
def tmp_assets(tmp_path: Path) -> Path:
    """Create a minimal assets/detect-ai-spark tree."""
    spark = tmp_path / "assets" / "detect-ai-spark"
    spark.mkdir(parents=True)
    (spark / "config.json").write_text('{"model": "spark"}', encoding="utf-8")
    (spark / "pytorch_model.bin").write_text("fake-weights", encoding="utf-8")
    # also create flare so supported model tests have something
    flare = tmp_path / "assets" / "detect-ai-flare"
    flare.mkdir(parents=True)
    (flare / "config.json").write_text('{"model": "flare"}', encoding="utf-8")
    return tmp_path


@pytest.fixture()
def env_no_token(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("HF_TOKEN", "HF_USERNAME", "ASSETS_DIR_NAME", "PROJECT_ROOT_DIR", "ENV_FILE"):
        monkeypatch.delenv(k, raising=False)
