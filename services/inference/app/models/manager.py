"""The pull orchestrator: locate-then-pull per spec, fail-fast on the first miss."""

from collections.abc import Mapping, Sequence
from pathlib import Path

from .spec import ModelSpec
from .store import ArtifactStore


class ModelArtifactManager:
    def __init__(self, specs: Sequence[ModelSpec], store: ArtifactStore) -> None:
        self._specs = tuple(specs)
        self._store = store

    def ensure_all(self) -> Mapping[str, Path]:
        raise NotImplementedError("ModelArtifactManager.ensure_all")
