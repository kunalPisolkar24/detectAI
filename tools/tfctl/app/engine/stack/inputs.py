"""Terraform inputs: the per-plane backend file and the temp-file landing."""

from __future__ import annotations

import tempfile
from pathlib import Path

from app.engine.declaration.model import Declaration, state_bucket_for
from app.engine.values.plane import resolve_floci_url, resolve_region


def state_key(declaration: Declaration, is_emulator: bool) -> str:
    segment = "floci/" if is_emulator else ""
    return f"{declaration.slug}/{segment}terraform.tfstate"


def state_bucket(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, account: str
) -> str:
    """The kind's bucket law: the account-suffixed derived name, unguessable."""
    return state_bucket_for(declaration.slug, account)


def build_backend_hcl(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    account: str,
    bucket: str | None = None,
) -> str:
    region = resolve_region(declaration, values)
    bucket = bucket or state_bucket(declaration, values, is_emulator, account)
    key = state_key(declaration, is_emulator)
    if is_emulator:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{key}"',
            f'region                      = "{region}"',
            "encrypt                     = false",
            "skip_credentials_validation = true",
            "skip_metadata_api_check     = true",
            "skip_requesting_account_id  = true",
            "skip_region_validation      = true",
            "use_path_style              = true",
            "endpoints = {",
            f'  s3 = "{resolve_floci_url()}"',
            "}",
        ]
    else:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{key}"',
            f'region                      = "{region}"',
            "encrypt                     = true",
            "use_lockfile                = true",
        ]
    return "\n".join(lines) + "\n"


def write_backend_hcl(backend_hcl: str) -> Path:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".hcl", delete=False) as handle:
        handle.write(backend_hcl)
        return Path(handle.name)
