"""Values plane: .env parsing, plane resolution, and per-verb validation."""

from __future__ import annotations

import os
import re
from secretsctl.config import Declaration

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")
URL_RE = re.compile(r"^https?://\S+$")
ENV_TYPES = ("dev", "prod")
EMULATOR_RECOVERY_WINDOW = 0
RECOVERY_WINDOW_MIN = 7
RECOVERY_WINDOW_MAX = 30

DEFAULT_FLOCI_URL = "http://localhost:4566"


def parse_env_file(path) -> dict[str, str]:
    """KEY=value parser: strips inline comments, keeps the first duplicate."""
    values: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = re.sub(r"\s+#.*$", "", value).strip()
        if not key:
            print(f"warning: {path.name}:{lineno}: empty key before '='; skipped")
            continue
        if key in values:
            print(f"warning: {path.name}:{lineno}: duplicate {key}; keeping the first")
            continue
        values[key] = value
    return values


def resolve_floci_url() -> str:
    """The emulator endpoint: an engine constant, overridable for exotic setups."""
    return os.environ.get("SECRETSCTL_FLOCI_URL") or DEFAULT_FLOCI_URL


def plane_display(is_emulator: bool) -> str:
    if is_emulator:
        return f"floci (emulator {resolve_floci_url()})"
    return "real AWS"


def resolve_plane(use_aws: bool) -> tuple[str, bool]:
    """The --aws/--floci flag decides; the values file never selects the plane."""
    is_emulator = not use_aws
    return plane_display(is_emulator), is_emulator


def resolve_region(declaration: Declaration, values: dict[str, str]) -> str:
    return values.get("AWS_REGION") or declaration.region_default


def resolve_recovery_window(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> int:
    """Emulator plane: always 0. Real AWS: the .env override or the declaration default."""
    if is_emulator:
        return EMULATOR_RECOVERY_WINDOW
    raw = values.get("SECRET_RECOVERY_WINDOW", "")
    if not raw:
        return declaration.recovery_window
    return int(raw)


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


def validate_bootstrap(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    """Only what bucket creation consumes; no blob-key or ENV_TYPE demands."""
    return plane_errors(values)


def plane_notes(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    notes = []
    if values.get("ENV_TYPE") == "prod" and is_emulator:
        notes.append(
            "note: ENV_TYPE=prod with the emulator — the local-testing shape for the prod pull path"
        )
    if values.get("ENV_TYPE") == "dev" and not is_emulator:
        notes.append(
            "warning: applying to real AWS while ENV_TYPE=dev (dev runtime reads .env, not SM)"
        )
    if values.get("SECRET_RECOVERY_WINDOW"):
        if is_emulator:
            notes.append("note: SECRET_RECOVERY_WINDOW ignored on the emulator plane (always 0)")
        elif values["SECRET_RECOVERY_WINDOW"] == "0":
            notes.append(
                "warning: SECRET_RECOVERY_WINDOW=0 on real AWS — destroy deletes the secret immediately"
            )
    return notes
