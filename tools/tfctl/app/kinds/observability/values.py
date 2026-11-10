"""The observability values law: credentials, the region shape, and plane choice."""

from __future__ import annotations

import os

from app.engine.declaration.model import REGION_RE, Declaration

API_KEY_RE = "NRAK-"
REGIONS = ("US", "EU", "JP")
API_KEY_MIN_LENGTH = 20


def resolve_credential(env_key: str, values: dict[str, str]) -> str | None:
    """Shell env wins per key; envs/.env fills the rest."""
    return os.environ.get(env_key) or values.get(env_key) or None


def build_config(values: dict[str, str]) -> dict[str, str | None]:
    return {
        "api_key": resolve_credential("NEW_RELIC_API_KEY", values),
        "account_id": resolve_credential("NEW_RELIC_ACCOUNT_ID", values),
        "region": resolve_credential("NEW_RELIC_REGION", values),
    }


def validate_config(config: dict[str, str | None]) -> list[str]:
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    api_key = config["api_key"]
    if not api_key:
        fail(
            "NEW_RELIC_API_KEY is empty in envs/.env",
            "export NEW_RELIC_API_KEY=NRAK-... for one run, or fill it in envs/.env "
            "(User API key from New Relic UI -> API keys & Credentials)",
        )
    elif not api_key.startswith(API_KEY_RE):
        fail(
            "NEW_RELIC_API_KEY is not a User API key: it must start with "
            f"'{API_KEY_RE}-...'. The ingest license key (eu01...) apps use for OTLP "
            "is the wrong credential class for Terraform.",
            "create a User key in New Relic UI -> API keys & Credentials",
        )
    elif len(api_key) < API_KEY_MIN_LENGTH:
        fail(
            "NEW_RELIC_API_KEY looks truncated (shorter than 20 chars)",
            "paste the full key from New Relic UI -> API keys & Credentials",
        )

    if (account_id := config["account_id"]) is not None and not account_id.isdigit():
        fail(
            f"NEW_RELIC_ACCOUNT_ID must be numeric, got {account_id!r}",
            "use the 7-digit account id from the New Relic footer or API keys page",
        )

    if (region := config["region"]) is not None and region.upper() not in REGIONS:
        fail(
            f"NEW_RELIC_REGION must be one of {', '.join(REGIONS)}, got {region!r}",
            "set US, EU or JP (matches api.<xr>.newrelic.com)",
        )
    return errors


def resolve_plane(values: dict[str, str], aws: bool, floci: bool) -> bool:
    """The plane follows the flags only: --aws rides real AWS, floci is the
    default any other way."""
    return not aws


def validate_state(values: dict[str, str]) -> list[str]:
    """Shape check only: what the region consumes.
    Credentials are validated by the verbs that consume them."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-southeast-2 (this is not NEW_RELIC_REGION)",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    """The kind's verb-wide validation: the values file's region shape.
    The credential triple is validated by the verbs that consume it."""
    return validate_state(values)
