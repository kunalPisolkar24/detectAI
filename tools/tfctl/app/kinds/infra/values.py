"""The infra values law: the state plane shapes and the plane choice.

No credential law — the queue fabric needs none: the values file only shapes
the state bucket and the region.
"""

from __future__ import annotations

import os
import re

from app.engine.declaration.model import REGION_RE, Declaration

# S3 naming minus dots: exactly 3-63 lowercase/digits/hyphens, alnum boundaries.
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

DEFAULT_STATE_BUCKET = "detectai-infra-tfstate"

BUCKET_MISSING_ERROR = (
    "the real-AWS plane needs a state bucket: TF_STATE_BUCKET is not set in envs/.env"
)
BUCKET_MISSING_FIX = (
    "add TF_STATE_BUCKET=<unique 3-63 char lowercase bucket> to envs/.env "
    "(the first plan/apply creates it on demand), or run with --floci for the "
    "emulator plane (its bucket defaults and no key is needed)"
)


def resolve_plane(values: dict[str, str], aws: bool, floci: bool) -> bool:
    """The plane follows the flags only: --aws rides real AWS, floci is the
    default any other way."""
    return not aws


def resolve_state_bucket(values: dict[str, str], is_emulator: bool) -> str | None:
    """State bucket for the plane: envs/.env value if set; Floci falls back to
    the fixed local default; real AWS stays required (no guessing)."""
    bucket = values.get("TF_STATE_BUCKET", "")
    if bucket:
        return bucket
    return DEFAULT_STATE_BUCKET if is_emulator else None


def warn_shell_conflicts(values: dict[str, str]) -> None:
    env_bucket = values.get("TF_STATE_BUCKET", "")
    shell_bucket = os.environ.get("TF_STATE_BUCKET")
    if env_bucket and shell_bucket and shell_bucket != env_bucket:
        print(
            f"note: TF_STATE_BUCKET also exported in the shell ({shell_bucket!r}); the .env value wins"
        )


def validate_state(values: dict[str, str]) -> list[str]:
    """Shape checks only: what the region and the bucket consume.
    A missing TF_STATE_BUCKET is not an error here — it defaults on the
    Floci plane and is demanded once a real-AWS terraform verb runs."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. eu-central-1 (it hosts the fabric and the state bucket)",
        )
    if (bucket := values.get("TF_STATE_BUCKET", "")) and not BUCKET_RE.fullmatch(bucket):
        fail(
            f"TF_STATE_BUCKET is not a valid S3 bucket name: {bucket!r}",
            "use 3-63 lowercase letters, digits or hyphens, starting and ending alphanumeric",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    """The kind's verb-wide validation: the values file's state-plane shapes."""
    return validate_state(values)
