"""Backward-compat shim — prefer PublishModelUseCase in use_cases.py."""

from __future__ import annotations

from pathlib import Path

from src.application.dto import PublishCommand
from src.application.use_cases import PublishModelUseCase
from src.interfaces.artifact_store import IArtifactStore
from src.interfaces.registry import IModelRegistry


class ModelPublisher:
    """Legacy façade kept for older imports; delegates to PublishModelUseCase."""

    def __init__(self, registry: IModelRegistry, store: IArtifactStore | None = None) -> None:
        self._registry = registry
        self._store = store
        # If no store injected (legacy bootstrap), create minimal resolver from settings lazily
        if self._store is None:
            from src.infrastructure.config.provider import get_settings
            from src.infrastructure.filesystem.resolver import LocalArtifactStore

            try:
                s = get_settings()
                self._store = LocalArtifactStore(
                    project_root=Path(s.project_root_dir),
                    assets_dir_name=s.assets_dir_name,
                )
            except Exception:
                # let publish() raise clearly if misconfigured
                self._store = None  # type: ignore[assignment]

    def publish(self, model_name: str, version: str) -> None:
        if self._store is None:
            raise RuntimeError("ModelPublisher not initialized with artifact store and settings unavailable")
        uc = PublishModelUseCase(self._registry, self._store)
        uc.execute(PublishCommand(model=model_name, version=version))
