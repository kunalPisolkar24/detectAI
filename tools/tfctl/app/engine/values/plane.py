"""Plane resolution: emulator vs real AWS, region, and the emulator endpoint."""

from __future__ import annotations

import os

from app.engine.declaration.model import Declaration

DEFAULT_FLOCI_URL = "http://localhost:4566"


def resolve_floci_url() -> str:
    """The emulator endpoint: an engine constant, overridable for exotic setups."""
    return os.environ.get("TFCTL_FLOCI_URL") or DEFAULT_FLOCI_URL


def plane_display(is_emulator: bool) -> str:
    if is_emulator:
        return f"floci (emulator {resolve_floci_url()})"
    return "real AWS"


def resolve_region(declaration: Declaration, values: dict[str, str]) -> str:
    return values.get("AWS_REGION") or declaration.region_default
