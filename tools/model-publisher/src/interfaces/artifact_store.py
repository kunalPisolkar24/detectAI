"""Port — artifact store (filesystem resolver abstraction)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from src.domain.schemas import ArtifactBundle


class IArtifactStore(ABC):
    @abstractmethod
    def resolve(self, model_key: str, version: str, description: str | None = None) -> ArtifactBundle:
        """Resolve model_key to a validated ArtifactBundle or raise ArtifactNotFoundException."""

    @abstractmethod
    def assets_path_for(self, model_key: str) -> Path:
        """Return the expected assets path for model_key (without checking existence)."""
