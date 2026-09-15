from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.application.dto import PublishCommand
from src.infrastructure.composition.container import build_publisher
from src.infrastructure.config.settings import Settings


@pytest.mark.integration
def test_composition_build_and_dry_run(tmp_path: Path, tmp_assets: Path) -> None:
    s = Settings(hf_token="hf_composition123", hf_username="alice", project_root_dir=str(tmp_assets), assets_dir_name="assets")
    api = MagicMock()
    # use container with injected mock api; dry-run must not call upload
    uc = build_publisher(s, api=api)
    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0", dry_run=True))
    assert result.dry_run is True
    api.upload_folder.assert_not_called()
    api.create_tag.assert_not_called()


@pytest.mark.integration
def test_composition_build_and_real_upload(tmp_assets: Path) -> None:
    s = Settings(hf_token="hf_composition123", hf_username="alice", project_root_dir=str(tmp_assets), assets_dir_name="assets")
    api = MagicMock()
    api.upload_folder.return_value = "https://huggingface.co/alice/detect-ai-spark/tree/v9.9.9"
    uc = build_publisher(s, api=api)
    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v9.9.9"))
    assert result.repo_id == "alice/detect-ai-spark"
    assert result.url is not None
    api.upload_folder.assert_called_once()
    api.create_tag.assert_called_once()


@pytest.mark.integration
def test_composition_assets_dir_override(tmp_path: Path, tmp_assets: Path) -> None:
    # override assets base to tmp_assets/assets explicitly
    s = Settings(hf_token="hf_composition123", hf_username="alice", project_root_dir="/nonexistent", assets_dir_name="assets")
    api = MagicMock()
    api.upload_folder.return_value = "https://huggingface.co/alice/detect-ai-spark/tree/v1.0.0"
    override = tmp_assets / "assets"
    uc = build_publisher(s, assets_dir_override=override, api=api)
    result = uc.execute(PublishCommand(model="detect-ai-spark", version="v1.0.0", dry_run=True))
    assert result.local_path == override / "detect-ai-spark"
