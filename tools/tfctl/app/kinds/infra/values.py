"""The infra values law: region shape, plus the cache fabric's placement and token.

The queue fabric needs no credentials; the cache fabric needs an AUTH token and
a plane-specific subnet, both of which live in the gitignored values file.
"""

from __future__ import annotations

from app.engine.declaration.model import REGION_RE, Declaration
from app.kinds.infra.tfvars import csv_items

CACHE_TOKEN_MIN = 16


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
            "use a plain region code, e.g. ap-southeast-2 (it hosts the fabrics and the state bucket)",
        )
    return errors


def validate_cache(values: dict[str, str]) -> list[str]:
    """The credential and placement law, applied only when a cache is declared."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    token = values.get("REDIS_AUTH_TOKEN", "").strip()
    if len(token) < CACHE_TOKEN_MIN:
        fail(
            f"REDIS_AUTH_TOKEN is required when [[elasticache]] is declared "
            f"({CACHE_TOKEN_MIN}+ characters)",
            "set REDIS_AUTH_TOKEN in envs/.env — it is the ElastiCache AUTH token",
        )
    if not csv_items(values.get("CACHE_SUBNET_IDS", "")):
        fail(
            "CACHE_SUBNET_IDS is required when [[elasticache]] is declared",
            "set CACHE_SUBNET_IDS in envs/.env (on floci: subnet-default-ap-southeast-2-a)",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    """The kind's verb-wide validation: values shape plus the declared fabrics."""
    errors = validate_state(values)
    if getattr(declaration, "cache_ledger", ()):
        errors.extend(validate_cache(values))
    return errors
