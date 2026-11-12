"""The artifact store port: the manager's entire view of pulling."""

from pathlib import Path
from typing import Protocol

from .spec import ModelSpec


class ArtifactStore(Protocol):
    def locate(self, spec: ModelSpec) -> Path:
        """Offline resolve at the pinned revision; raises MissingArtifact on a miss."""
        ...

    def pull(self, spec: ModelSpec) -> Path:
        """Fetch the artifact from its source and return the local dir."""
        ...
