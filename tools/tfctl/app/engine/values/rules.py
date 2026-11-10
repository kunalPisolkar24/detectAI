"""Shared plane checks for every kind: the values file's AWS_REGION shape."""

from __future__ import annotations

from app.engine.declaration.model import REGION_RE


def plane_errors(values: dict[str, str]) -> list[str]:
    """Region checks shared by every verb validator."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-southeast-2",
        )
    return errors
