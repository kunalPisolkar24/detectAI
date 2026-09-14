"""Composition root — single place that wires dependencies."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

from src.application.use_cases import SeedUseCase
from src.infrastructure.config.settings import Settings
from src.infrastructure.filesystem.env_loader import LocalEnvLoader
from src.infrastructure.secrets_manager import Boto3SecretsManager
from src.interfaces.env_loader import IEnvLoader
from src.interfaces.secrets_store import ISecretsStore


def build_env_loader(repo_root: Path | None = None) -> IEnvLoader:
    return LocalEnvLoader(repo_root=repo_root)


def build_secrets_store(
    settings: Settings,
    *,
    endpoint_url: str | None = None,
    region: str | None = None,
    client: Any | None = None,
    client_factory: Any | None = None,
) -> ISecretsStore:
    return Boto3SecretsManager(
        region=region or settings.region,
        endpoint_url=endpoint_url if endpoint_url is not None else settings.endpoint_url,
        client=client,
        client_factory=client_factory,
    )


def build_seeder(
    settings: Settings,
    *,
    endpoint_url: str | None = None,
    region: str | None = None,
    client: Any | None = None,
    client_factory: Any | None = None,
    key_gen: Callable[[int], str] | None = None,
    repo_root: Path | None = None,
) -> tuple[SeedUseCase, IEnvLoader]:
    store = build_secrets_store(
        settings, endpoint_url=endpoint_url, region=region, client=client, client_factory=client_factory
    )
    loader = build_env_loader(repo_root=repo_root)
    seeder = SeedUseCase(store=store, key_gen=key_gen)
    return seeder, loader
