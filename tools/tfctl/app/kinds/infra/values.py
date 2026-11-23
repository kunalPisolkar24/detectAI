"""The infra values law: region shape, plus the declared fabrics' credentials.

The queue fabric needs no credentials; the cache needs a plane-specific subnet,
Aurora needs master credentials and subnet IDs, and Atlas needs API keys, a DB
user and explicit CIDRs. All of it lives in the gitignored values file. Atlas is
a public API with its own keys, so its law applies on every plane when the
fabric is declared.
"""

from __future__ import annotations

import ipaddress
import re

from app.engine.declaration.model import REGION_RE, Declaration
from app.kinds.infra.tfvars import csv_items

CACHE_TOKEN_MIN = 16
ATLAS_PROJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")


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
    """The placement law, applied only when a cache is declared."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if not csv_items(values.get("CACHE_SUBNET_IDS", "")):
        fail(
            "CACHE_SUBNET_IDS is required when [[elasticache]] is declared",
            "set CACHE_SUBNET_IDS in envs/.env (on floci: subnet-default-ap-southeast-2-a)",
        )
    return errors


def validate_atlas(values: dict[str, str]) -> list[str]:
    """The Atlas law, applied whenever the fabric is declared."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    def required(key: str, minimum: int = 1) -> str:
        value = values.get(key, "").strip()
        if len(value) < minimum:
            fail(
                f"{key} is required when [[atlas]] is declared ({minimum}+ characters)"
                if minimum > 1
                else f"{key} is required when [[atlas]] is declared",
                f"set {key} in envs/.env",
            )
        return value

    # Atlas public keys are 8 characters; the private key is a 36-char UUID.
    required("MONGODB_ATLAS_PUBLIC_KEY", 8)
    required("MONGODB_ATLAS_PRIVATE_KEY", 16)
    project_id = required("MONGODB_ATLAS_PROJECT_ID")
    if project_id and not ATLAS_PROJECT_ID_RE.fullmatch(project_id):
        fail(
            f"MONGODB_ATLAS_PROJECT_ID must be a 24-character hex string, got {project_id!r}",
            "copy the project ID from Atlas Project Settings",
        )
    required("ATLAS_DB_USERNAME")
    required("ATLAS_DB_PASSWORD", CACHE_TOKEN_MIN)
    cidrs = csv_items(values.get("ATLAS_IP_CIDRS", ""))
    if not cidrs:
        fail(
            "ATLAS_IP_CIDRS is required when [[atlas]] is declared",
            "set explicit IPv4/IPv6 CIDRs in envs/.env — the free tier has no private endpoints",
        )
    for cidr in cidrs:
        try:
            ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            fail(
                f"ATLAS_IP_CIDRS entry {cidr!r} is not a valid IPv4 or IPv6 CIDR",
                "use entries like 203.0.113.7/32 or 2401:db8::/64",
            )
    return errors


def validate_db(values: dict[str, str]) -> list[str]:
    """The Aurora credential and placement law, applied only when declared."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    username = values.get("DB_MASTER_USERNAME", "").strip()
    if not username:
        fail(
            "DB_MASTER_USERNAME is required when [[aurora]] is declared",
            "set DB_MASTER_USERNAME in envs/.env — it is the Aurora master user",
        )
    password = values.get("DB_MASTER_PASSWORD", "").strip()
    if len(password) < 16:
        fail(
            "DB_MASTER_PASSWORD is required when [[aurora]] is declared (16+ characters)",
            "set DB_MASTER_PASSWORD in envs/.env — it is the Aurora master password",
        )
    if not csv_items(values.get("DB_SUBNET_IDS", "")):
        fail(
            "DB_SUBNET_IDS is required when [[aurora]] is declared",
            "set at least two subnet IDs in envs/.env, one per AZ",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    """The kind's verb-wide validation: values shape plus the declared fabrics."""
    errors = validate_state(values)
    if getattr(declaration, "cache_ledger", ()):
        errors.extend(validate_cache(values))
    if getattr(declaration, "atlas_ledger", ()):
        errors.extend(validate_atlas(values))
    if getattr(declaration, "aurora_ledger", ()):
        errors.extend(validate_db(values))
    return errors
