"""Per-verb validation rules over the parsed .env values, and the secrets-only plane knobs."""

from __future__ import annotations

import re

from app.engine.values.rules import plane_errors
from app.kinds.secrets.declaration import SecretsDeclaration

URL_RE = re.compile(r"^https?://\S+$")
ENV_TYPES = ("dev", "prod")
RECOVERY_WINDOW_MIN = 7
RECOVERY_WINDOW_MAX = 30

EMULATOR_RECOVERY_WINDOW = 0


def resolve_plane(values: dict[str, str], aws: bool, floci: bool) -> bool:
    """The secrets plane follows the plane flags only: --aws rides real AWS,
    floci stays the default any other way."""
    return not aws


def validate(secrets: SecretsDeclaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    for key, floor in secrets.min_lengths.items():
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
    for trigger, (required_key, floor) in secrets.requires.items():
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


def resolve_recovery_window(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool
) -> int:
    """Emulator plane: always 0. Real AWS: the .env override or the declaration default."""
    if is_emulator:
        return EMULATOR_RECOVERY_WINDOW
    raw = values.get("SECRET_RECOVERY_WINDOW", "")
    if not raw:
        return declaration.recovery_window
    return int(raw)


def plane_notes(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
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
