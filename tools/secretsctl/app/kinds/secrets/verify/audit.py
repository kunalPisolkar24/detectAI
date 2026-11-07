"""Fingerprinting drift: expected seeds from .env and value comparison."""

from __future__ import annotations

import hashlib

from app.kinds.secrets.declaration import SecretsDeclaration


def fingerprint(value: str) -> str:
    """Short reproducible checksum for locating drift; never renders the value."""
    return hashlib.sha256(value.encode()).hexdigest()[:12]


def expected_ssm_seeds(declaration: SecretsDeclaration, values: dict[str, str]) -> dict[str, str]:
    """The SSM map the stack would seed: the .env-populated allowlist subset."""
    return {key: values[key] for key in declaration.ssm_keys if values.get(key, "") != ""}


def expected_blob(declaration: SecretsDeclaration, values: dict[str, str]) -> dict[str, str]:
    """The blob contract rebuilt from .env: every declared key rides the blob when set."""
    return {key: values[key] for key in declaration.blob_keys if values.get(key, "") != ""}


def compare_seeds(
    expected: dict[str, str], live: dict[str, str]
) -> tuple[list[str], list[str], list[str]]:
    """Shared keys split by value fingerprint into (matched, mismatched); plus
    expected keys absent from the live plane."""
    matched, mismatched = [], []
    for key in sorted(set(expected) & set(live)):
        matched_or_mismatched = (
            matched if fingerprint(expected[key]) == fingerprint(live[key]) else mismatched
        )
        matched_or_mismatched.append(key)
    return matched, mismatched, sorted(set(expected) - set(live))
