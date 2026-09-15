"""Application DTOs — inputs/outputs of use-cases."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PublishCommand:
    model: str
    version: str
    description: str | None = None
    assets_dir: Path | str | None = None
    dry_run: bool = False


@dataclass(frozen=True)
class PublishResult:
    model: str
    version: str
    repo_id: str
    url: str | None
    dry_run: bool
    local_path: Path
