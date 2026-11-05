"""Plane resolution: emulator vs real AWS, region, and recovery window."""

from __future__ import annotations

import os

from app.declaration.model import Declaration

EMULATOR_RECOVERY_WINDOW = 0

DEFAULT_FLOCI_URL = "http://localhost:4566"


def resolve_floci_url() -> str:
    """The emulator endpoint: an engine constant, overridable for exotic setups."""
    return os.environ.get("SECRETSCTL_FLOCI_URL") or DEFAULT_FLOCI_URL


def plane_display(is_emulator: bool) -> str:
    if is_emulator:
        return f"floci (emulator {resolve_floci_url()})"
    return "real AWS"


def resolve_plane(use_aws: bool) -> tuple[str, bool]:
    """The --aws/--floci flag decides; the values file never selects the plane."""
    is_emulator = not use_aws
    return plane_display(is_emulator), is_emulator


def resolve_region(declaration: Declaration, values: dict[str, str]) -> str:
    return values.get("AWS_REGION") or declaration.region_default


def resolve_recovery_window(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> int:
    """Emulator plane: always 0. Real AWS: the .env override or the declaration default."""
    if is_emulator:
        return EMULATOR_RECOVERY_WINDOW
    raw = values.get("SECRET_RECOVERY_WINDOW", "")
    if not raw:
        return declaration.recovery_window
    return int(raw)


def plane_notes(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    notes = []
    if values.get("ENV_TYPE") == "prod" and is_emulator:
        notes.append(
            "note: ENV_TYPE=prod with the emulator — the local-testing shape for the prod pull path"
        )
    if values.get("ENV_TYPE") == "dev" and not is_emulator:
        notes.append(
            "warning: applying to real AWS while ENV_TYPE=dev (dev runtime reads .env, not SM)"
        )
    if values.get("SECRET_RECOVERY_WINDOW"):
        if is_emulator:
            notes.append("note: SECRET_RECOVERY_WINDOW ignored on the emulator plane (always 0)")
        elif values["SECRET_RECOVERY_WINDOW"] == "0":
            notes.append(
                "warning: SECRET_RECOVERY_WINDOW=0 on real AWS — destroy deletes the secret immediately"
            )
    return notes
