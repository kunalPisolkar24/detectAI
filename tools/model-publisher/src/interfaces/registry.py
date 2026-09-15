"""Port — model registry abstraction."""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.domain.schemas import ArtifactBundle


class IModelRegistry(ABC):
    @abstractmethod
    def upload_artifacts(self, bundle: ArtifactBundle) -> str:
        """Upload bundle.local_path to remote; return URL/commit id."""

    @abstractmethod
    def set_version_tag(self, bundle: ArtifactBundle) -> None:
        """Create a version tag for the already-uploaded artifacts."""
