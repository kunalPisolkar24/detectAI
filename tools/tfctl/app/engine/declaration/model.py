"""Stack declaration dataclasses and the state names they derive."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")


def seeder_role_for(slug: str) -> str:
    return f"detectai-{slug}-seeder"


def state_bucket_for(slug: str, account: str) -> str:
    """The stack's state bucket on any plane: slug-derived, account-suffixed
    for global S3 uniqueness (the account owning the seeder role and stack)."""
    return f"detectai-{slug}-tfstate-{account}"


@dataclass
class Declaration:
    """The engine-facing face of a stack: what every shared mechanism reads.

    Kinds extend this class with their own declared fields; the engine only
    ever reads these five."""

    kind: str
    slug: str
    seeder_role_name: str
    region_default: str
    stack_root: Path


class DeclarationError(Exception):
    """Raised when a declaration file cannot be read or breaks its kind's schema."""
