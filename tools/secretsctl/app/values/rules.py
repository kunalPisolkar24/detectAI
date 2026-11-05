"""Per-verb validation rules over the parsed .env values."""

from __future__ import annotations

import re

from app.declaration.model import Declaration

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")
URL_RE = re.compile(r"^https?://\S+$")
ENV_TYPES = ("dev", "prod")
RECOVERY_WINDOW_MIN = 7
RECOVERY_WINDOW_MAX = 30


def plane_errors(values: dict[str, str]) -> list[str]:
    """Region checks shared by every verb validator."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-southeast-2",
        )
    return errors


def validate(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    for key, floor in declaration.min_lengths.items():
        if len(values.get(key, "")) < floor:
            fail(
                f"{key} missing or shorter than {floor} chars in the service .env",
                f"set a real value, e.g. {key}=<at least {floor} chars>",
            )
    if (env_type := values.get("ENV_TYPE")) is not None and env_type not in ENV_TYPES:
        fail(
            f"ENV_TYPE must be one of {' or '.join(ENV_TYPES)}, got {env_type!r}",
            "set ENV_TYPE=dev or ENV_TYPE=prod",
        )
    if (raw := values.get("SECRET_RECOVERY_WINDOW", "")) and not is_emulator:
        # The emulator ignores the key outright, so only the real plane polices it.
        parsed = int(raw) if raw.isdigit() else None
        if parsed is None:
            fail(
                f"SECRET_RECOVERY_WINDOW is not a whole number of days: {raw!r}",
                "use 0 (drop the secret at destroy time) or 7-30 (keep the AWS window)",
            )
        elif parsed != 0 and not RECOVERY_WINDOW_MIN <= parsed <= RECOVERY_WINDOW_MAX:
            fail(
                f"SECRET_RECOVERY_WINDOW must be 0 or between {RECOVERY_WINDOW_MIN} and "
                f"{RECOVERY_WINDOW_MAX}, got {raw}",
                f"Secrets Manager accepts 0 or {RECOVERY_WINDOW_MIN}-{RECOVERY_WINDOW_MAX}; "
                "the terraform variable enforces the same rule",
            )
    for trigger, (required_key, floor) in declaration.requires.items():
        if not values.get(trigger, ""):
            continue
        if len(values.get(required_key, "")) < floor:
            fail(
                f"{required_key} missing or shorter than {floor} chars while {trigger} is set",
                "set the required companion key in .env (a throwaway value is legitimate "
                "when the endpoint is a local receiver)",
            )
    if endpoint := values.get("OTEL_EXPORTER_OTLP_ENDPOINT", ""):
        if not URL_RE.fullmatch(endpoint):
            fail(
                f"OTEL_EXPORTER_OTLP_ENDPOINT is not a valid http(s) URL: {endpoint!r}",
                "use an http(s) OTLP endpoint, e.g. http://localhost:4318 (a local receiver) "
                "or https://otlp.nr-data.net (New Relic)",
            )
    errors.extend(plane_errors(values))
    return errors
