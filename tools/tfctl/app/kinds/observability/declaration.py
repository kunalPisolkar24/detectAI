"""The observability stack's declaration: one fixed root described by observability.toml."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from app.engine.declaration.model import REGION_RE, Declaration, DeclarationError, seeder_role_for

SLUG = "observability"
STATE_REGION_DEFAULT = "ap-southeast-2"

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TOP_SECTIONS = {"service"}
SERVICE_FIELDS = {"slug", "region"}


@dataclass
class ObservabilityDeclaration(Declaration):
    """The engine-facing face of the one observability stack."""


def declaration_errors(data: dict) -> list[str]:
    errors: list[str] = []

    def fail(message: str) -> None:
        errors.append(f"error: observability.toml — {message}")

    unknown = set(data) - TOP_SECTIONS
    if unknown:
        fail(f"unknown section(s) {sorted(unknown)}; allowed: {sorted(TOP_SECTIONS)}")
    service = data.get("service")
    if not isinstance(service, dict):
        fail("[service] is required")
        return errors

    extra = set(service) - SERVICE_FIELDS
    if extra:
        fail(f"[service] has unknown field(s) {sorted(extra)}; allowed: {sorted(SERVICE_FIELDS)}")

    slug = service.get("slug")
    if slug != SLUG:
        fail(
            f'slug must be "{SLUG}" (the state keys and the seeder role derive from it), '
            f"got {slug!r}"
        )

    region = service.get("region")
    if region is not None and (not isinstance(region, str) or not REGION_RE.fullmatch(region)):
        fail(f"region {region!r} must be a plain region code, e.g. {STATE_REGION_DEFAULT}")
    return errors


def load(toml_path: Path) -> ObservabilityDeclaration:
    try:
        data = tomllib.loads(toml_path.read_text())
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise DeclarationError(f"cannot read {toml_path}: {exc}") from exc
    errors = declaration_errors(data)
    if errors:
        raise DeclarationError("\n".join(errors))
    service = data["service"]
    return ObservabilityDeclaration(
        kind="observability",
        slug=SLUG,
        seeder_role_name=seeder_role_for(SLUG),
        region_default=service.get("region", STATE_REGION_DEFAULT),
        stack_root=toml_path.resolve().parent / "terraform",
    )
