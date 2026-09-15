"""Use-case — publish a model artifact bundle."""

from __future__ import annotations

import logging

from src.application.dto import PublishCommand, PublishResult
from src.core.constants import DEFAULT_DESCRIPTION_TEMPLATE
from src.interfaces.artifact_store import IArtifactStore
from src.interfaces.registry import IModelRegistry

logger = logging.getLogger(__name__)


class PublishModelUseCase:
    def __init__(self, registry: IModelRegistry, store: IArtifactStore) -> None:
        self._registry = registry
        self._store = store

    def execute(self, cmd: PublishCommand) -> PublishResult:
        description = cmd.description or DEFAULT_DESCRIPTION_TEMPLATE.format(version=cmd.version)

        # Resolver handles FS validation and bundle creation (pure domain outside)
        bundle = self._store.resolve(cmd.model, cmd.version, description)

        # dry-run: validate only, never touch network
        if cmd.dry_run:
            logger.info("dry-run validated", extra={"model": cmd.model, "version": cmd.version})
            # repo_id is derived via registry internal, but expose via store path or construct
            # We ask registry for its naming via a private helper if available; fallback to bundle key
            repo_id = getattr(self._registry, "_username", "unknown")  # fallback
            # Prefer registry._get_repo_id if present
            get_repo = getattr(self._registry, "_get_repo_id", None)
            if callable(get_repo):
                try:
                    repo_id = get_repo(bundle.metadata.model_key)  # type: ignore[misc]
                except Exception:
                    repo_id = bundle.metadata.model_key
            else:
                repo_id = bundle.metadata.model_key
            return PublishResult(
                model=bundle.metadata.model_key,
                version=bundle.metadata.version,
                repo_id=str(repo_id),
                url=None,
                dry_run=True,
                local_path=bundle.local_path,
            )

        url = self._registry.upload_artifacts(bundle)
        self._registry.set_version_tag(bundle)

        repo_get = getattr(self._registry, "_get_repo_id", None)
        if callable(repo_get):
            try:
                repo_id = repo_get(bundle.metadata.model_key)  # type: ignore[misc]
            except Exception:
                repo_id = bundle.metadata.model_key
        else:
            repo_id = bundle.metadata.model_key

        return PublishResult(
            model=bundle.metadata.model_key,
            version=bundle.metadata.version,
            repo_id=str(repo_id),
            url=url,
            dry_run=False,
            local_path=bundle.local_path,
        )
