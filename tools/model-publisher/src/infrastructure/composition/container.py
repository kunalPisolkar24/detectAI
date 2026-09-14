"""Composition root — single place that wires dependencies."""

from __future__ import annotations

from pathlib import Path

from huggingface_hub import HfApi

from src.application.use_cases import PublishModelUseCase
from src.infrastructure.config.settings import Settings
from src.infrastructure.filesystem.resolver import LocalArtifactStore
from src.infrastructure.huggingface.registry import HuggingFaceRegistry
from src.interfaces.artifact_store import IArtifactStore
from src.interfaces.registry import IModelRegistry


def build_registry(settings: Settings, api: HfApi | None = None) -> IModelRegistry:
    hf_api = api or HfApi(token=settings.hf_token)
    return HuggingFaceRegistry(api=hf_api, username=settings.hf_username)


def build_artifact_store(
    settings: Settings, *, assets_dir_override: Path | str | None = None
) -> IArtifactStore:
    root = Path(settings.project_root_dir)
    if assets_dir_override is not None:
        # assets_dir_override is a full path to the assets folder base (e.g. /tmp/.../assets)
        # If caller passed a full assets base, extract its parent/root handling:
        # We expose assets_path_for via root/assets_dir_name, so if override is absolute path,
        # treat its parent as root and its name as assets_dir_name when it ends with assets.
        p = Path(assets_dir_override)
        if p.is_absolute():
            # if user gave explicit assets base dir (e.g. /tmp/x/assets), honor it
            return LocalArtifactStore(project_root=p.parent, assets_dir_name=p.name)
        # relative override -> treat as assets_dir_name
        return LocalArtifactStore(project_root=root, assets_dir_name=str(p))
    return LocalArtifactStore(project_root=root, assets_dir_name=settings.assets_dir_name)


def build_publisher(
    settings: Settings,
    *,
    assets_dir_override: Path | str | None = None,
    api: HfApi | None = None,
) -> PublishModelUseCase:
    registry = build_registry(settings, api=api)
    store = build_artifact_store(settings, assets_dir_override=assets_dir_override)
    return PublishModelUseCase(registry=registry, store=store)
