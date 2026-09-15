from __future__ import annotations

from pathlib import Path

import pytest

from src.core.exceptions import ArtifactNotFoundException
from src.infrastructure.filesystem.resolver import LocalArtifactStore


@pytest.mark.integration
def test_resolver_finds_existing_assets(tmp_assets: Path) -> None:
    store = LocalArtifactStore(project_root=tmp_assets, assets_dir_name="assets")
    bundle = store.resolve("detect-ai-spark", "v1.0.0")
    assert bundle.local_path.exists()
    assert bundle.metadata.model_key == "detect-ai-spark"
    assert bundle.metadata.version == "v1.0.0"


@pytest.mark.integration
def test_resolver_raises_for_missing_assets(tmp_path: Path) -> None:
    store = LocalArtifactStore(project_root=tmp_path, assets_dir_name="assets")
    with pytest.raises(ArtifactNotFoundException) as ei:
        store.resolve("detect-ai-spark", "v1.0.0")
    assert "Assets not found" in str(ei.value)
    assert ei.value.path is not None


@pytest.mark.integration
def test_resolver_rejects_invalid_version(tmp_assets: Path) -> None:
    store = LocalArtifactStore(project_root=tmp_assets, assets_dir_name="assets")
    with pytest.raises(Exception) as ei:
        store.resolve("detect-ai-spark", "bad-version")
    assert "version" in str(ei.value).lower()


@pytest.mark.integration
def test_resolver_rejects_file_not_dir(tmp_path: Path) -> None:
    assets = tmp_path / "assets" / "detect-ai-spark"
    assets.parent.mkdir(parents=True)
    assets.write_text("i am a file, not a dir")
    store = LocalArtifactStore(project_root=tmp_path, assets_dir_name="assets")
    with pytest.raises(ArtifactNotFoundException):
        store.resolve("detect-ai-spark", "v1.0.0")


@pytest.mark.integration
def test_assets_path_for_is_pure() -> None:
    store = LocalArtifactStore(project_root="/tmp/root", assets_dir_name="assets")
    assert store.assets_path_for("detect-ai-spark") == Path("/tmp/root/assets/detect-ai-spark")
