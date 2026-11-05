"""Service declaration dataclasses and the names they derive."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

DEFAULT_REGION = "ap-southeast-2"
DEFAULT_RECOVERY_WINDOW = 30


def secret_name(slug: str) -> str:
    return f"detectai/{slug}/secrets"


def ssm_prefix_for(slug: str) -> str:
    return f"/detectai/{slug}/"


def seeder_role_for(slug: str) -> str:
    return f"detectai-{slug}-seeder"


def state_bucket_for(slug: str, account: str) -> str:
    """The service's state bucket on any plane: slug-derived, account-suffixed
    for global S3 uniqueness (the account owning the seeder role and stack)."""
    return f"detectai-{slug}-tfstate-{account}"


@dataclass
class Declaration:
    slug: str
    secret_name: str
    ssm_prefix: str
    blob_keys: tuple[str, ...]
    ssm_keys: tuple[str, ...]
    min_lengths: dict[str, int]
    requires: dict[str, tuple[str, int]]
    seeder_role_name: str
    region_default: str
    recovery_window: int


@dataclass
class Workspace:
    service_dir: Path
    values_file: Path
