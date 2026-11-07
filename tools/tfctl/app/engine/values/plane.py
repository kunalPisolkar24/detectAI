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


def emulator_endpoint_note(values: dict[str, str], where: str = "the values file") -> str | None:
    """A legacy EMULATOR_ENDPOINT line rates one note; the plane never reads it."""
    if "EMULATOR_ENDPOINT" not in values:
        return None
    return (
        f"note: EMULATOR_ENDPOINT in {where} is ignored; "
        "the plane comes from --aws/--floci (default: floci)"
    )


def resolve_region(declaration: Declaration, values: dict[str, str]) -> str:
    return values.get("AWS_REGION") or declaration.region_default
