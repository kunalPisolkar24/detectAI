"""The infra values law: the region shape and the plane choice.

No credential law — the queue fabric needs none: the values file only shapes
the region.
"""

from __future__ import annotations

from app.engine.declaration.model import REGION_RE, Declaration


def resolve_plane(values: dict[str, str], aws: bool, floci: bool) -> bool:
    """The plane follows the flags only: --aws rides real AWS, floci is the
    default any other way."""
    return not aws


def validate_state(values: dict[str, str]) -> list[str]:
    """Shape check only: what the region consumes."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-southeast-2 (it hosts the fabric and the state bucket)",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    """The kind's verb-wide validation: the values file's region shape."""
    return validate_state(values)
