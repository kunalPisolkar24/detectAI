"""Reading a service's secrets.toml into its Declaration."""

from __future__ import annotations

import tomllib
from pathlib import Path

from app.declaration.model import (
    DEFAULT_REGION,
    DEFAULT_RECOVERY_WINDOW,
    Declaration,
    secret_name,
    seeder_role_for,
    ssm_prefix_for,
)
from app.declaration.schema import declaration_errors


class DeclarationError(Exception):
    pass


def load(toml_path: Path) -> Declaration:
    try:
        data = tomllib.loads(toml_path.read_text())
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise DeclarationError(f"cannot read {toml_path}: {exc}") from exc
    errors = declaration_errors(data)
    if errors:
        raise DeclarationError("\n".join(errors))

    service = data["service"]
    slug: str = service["slug"]
    blob_keys = tuple(data.get("secrets", {}).get("keys", []))
    min_lengths = dict(data.get("secrets", {}).get("min_lengths", {}))
    requires = {
        trigger: (pair[0], int(pair[1])) for trigger, pair in data.get("requires", {}).items()
    }
    return Declaration(
        slug=slug,
        secret_name=secret_name(slug),
        ssm_prefix=ssm_prefix_for(slug),
        blob_keys=blob_keys,
        ssm_keys=tuple(data.get("ssm", {}).get("keys", [])),
        min_lengths=min_lengths,
        requires=requires,
        seeder_role_name=seeder_role_for(slug),
        region_default=service.get("region", DEFAULT_REGION),
        recovery_window=service.get("recovery_window", DEFAULT_RECOVERY_WINDOW),
    )
