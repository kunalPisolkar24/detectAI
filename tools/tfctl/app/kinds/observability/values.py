"""The observability values law: credentials, the S3 state plane, and plane choice."""

from __future__ import annotations

import os
import re

from app.engine.declaration.model import REGION_RE, Declaration

API_KEY_RE = "NRAK-"
REGIONS = ("US", "EU", "JP")
API_KEY_MIN_LENGTH = 20

URL_RE = re.compile(r"^https?://\S+$")
# S3 naming minus dots: exactly 3-63 lowercase/digits/hyphens, alnum boundaries.
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

DEFAULT_STATE_BUCKET = "detectai-observability-tfstate"

BUCKET_MISSING_ERROR = (
    "the real-AWS plane needs a state bucket: TF_STATE_BUCKET is not set in envs/.env"
)
BUCKET_MISSING_FIX = (
    "add TF_STATE_BUCKET=<unique 3-63 char lowercase bucket> to envs/.env "
    "(the bootstrap verb creates it), or set EMULATOR_ENDPOINT=http://localhost:4566 "
    "for the Floci plane"
)


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
    """--aws forces real AWS, --floci forces Floci; otherwise envs/.env decides:
    an EMULATOR_ENDPOINT line selects the Floci plane (the state plane stays
    reproducible, not per-invocation)."""
    if aws:
        return False
    if floci:
        return True
    return bool(values.get("EMULATOR_ENDPOINT"))


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


def validate_state(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Shape checks only: what the resolved plane, region and URL consume.
    A missing TF_STATE_BUCKET is not an error here — it defaults on the
    Floci plane and is demanded once a real-AWS terraform verb runs."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid state-bucket region: {region!r}",
            "use a plain region code, e.g. ap-south-1 (this is not NEW_RELIC_REGION)",
        )
    if is_emulator and (endpoint := values.get("EMULATOR_ENDPOINT")) is not None:
        if not URL_RE.fullmatch(endpoint):
            fail(
                f"EMULATOR_ENDPOINT is not a valid http(s) URL: {endpoint!r}",
                "set it to the Floci URL (http://localhost:4566) or remove the line for real AWS",
            )
    if (bucket := values.get("TF_STATE_BUCKET", "")) and not BUCKET_RE.fullmatch(bucket):
        fail(
            f"TF_STATE_BUCKET is not a valid S3 bucket name: {bucket!r}",
            "use 3-63 lowercase letters, digits or hyphens, starting and ending alphanumeric",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    """The kind's verb-wide validation: the values file's state-plane shapes.
    The credential triple is validated by the verbs that consume it."""
    return validate_state(is_emulator, values)
