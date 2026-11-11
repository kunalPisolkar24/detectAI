"""The dev boot through the real composition: flick -> ConfigFactory -> Settings.

The pins come from the integration conftest; the assertions prove the
composition's own behavior — the pinned process env wins the merge over the
host's infra/.env, and a file claiming prod never flips the fail-closed flick.
"""

from pathlib import Path

import pytest

from app.config import ConfigFactory, Settings, deployment_flick

from ..conftest import KEY


def test_the_dev_composition_resolves_the_pinned_boot_over_the_host_plane() -> None:
    settings = Settings.from_provider(ConfigFactory.create(deployment_flick()))

    assert deployment_flick() == "dev"
    assert settings.api_key == KEY  # the pin beats the host infra/.env


def test_a_file_claiming_prod_never_flips_the_flick(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plane = tmp_path / ".env"
    plane.write_text("ENV_TYPE=prod\nAPI_KEY=file-key-16-chars\n")
    monkeypatch.setenv("DOTENV_PATH", str(plane))
    monkeypatch.delenv("ENV_TYPE", raising=False)
    monkeypatch.delenv("API_KEY", raising=False)  # the file answers, not the pin

    assert deployment_flick() == "dev"

    settings = Settings.from_provider(ConfigFactory.create("dev"))
    assert settings.api_key == "file-key-16-chars"  # the file feeds the dev plane, never the flick
