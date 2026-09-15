"""Filesystem artifact resolver — the only place that touches Path.exists()."""

from __future__ import annotations

from pathlib import Path

from src.core.exceptions import ArtifactNotFoundException
from src.domain.schemas import ArtifactBundle, ModelMetadata
from src.interfaces.artifact_store import IArtifactStore


class LocalArtifactStore(IArtifactStore):
    def __init__(self, project_root: Path | str, assets_dir_name: str = "assets") -> None:
        self._root = Path(project_root).resolve()
        self._assets_dir_name = assets_dir_name

    def assets_path_for(self, model_key: str) -> Path:
        return self._root / self._assets_dir_name / model_key

    def resolve(self, model_key: str, version: str, description: str | None = None) -> ArtifactBundle:
        desc = description if description is not None else f"Production release {version}"
        metadata = ModelMetadata(model_key=model_key, version=version, description=desc)

        assets_path = self.assets_path_for(metadata.model_key)

        if not assets_path.exists():
            raise ArtifactNotFoundException(f"Assets not found at {assets_path}", path=str(assets_path))
        if not assets_path.is_dir():
            raise ArtifactNotFoundException(f"Assets path is not a directory: {assets_path}", path=str(assets_path))

        # bundle validation stays pure (no exists check)
        return ArtifactBundle(metadata=metadata, local_path=assets_path)
