"""secrets.toml schema rules: section and field allowlists and value shapes."""

from __future__ import annotations

import re

from app.declaration.model import REGION_RE

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
PLANE_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")

RECOVERY_WINDOW_MIN = 7
RECOVERY_WINDOW_MAX = 30

TOP_SECTIONS = {"service", "secrets", "ssm", "requires"}
SECRETS_FIELDS = {"keys", "min_lengths"}
SSM_FIELDS = {"keys"}
SECTION_FIELDS = {"secrets": SECRETS_FIELDS, "ssm": SSM_FIELDS}
SERVICE_FIELDS = {"slug", "region", "recovery_window"}


def _sections_of(data: dict, fail) -> dict[str, dict]:
    """The three optional tables, normalized: a non-table section earns one
    error and reads as empty, so the rest of the schema check stays crash-free."""
    sections: dict[str, dict] = {}
    for section in ("secrets", "ssm", "requires"):
        raw = data.get(section)
        if raw is None:
            sections[section] = {}
        elif isinstance(raw, dict):
            sections[section] = raw
        else:
            fail(f"[{section}] must be a table")
            sections[section] = {}
    return sections


def declaration_errors(data: dict) -> list[str]:
    errors: list[str] = []

    def fail(message: str) -> None:
        errors.append(f"error: secrets.toml — {message}")

    unknown = set(data) - TOP_SECTIONS
    if unknown:
        fail(f"unknown section(s) {sorted(unknown)}; allowed: {sorted(TOP_SECTIONS)}")
    service = data.get("service")
    if not isinstance(service, dict):
        fail("[service] is required")
        return errors

    sections = _sections_of(data, fail)
    secrets = sections["secrets"]
    ssm = sections["ssm"]
    for section, allowed in SECTION_FIELDS.items():
        extra = set(sections[section]) - allowed
        if extra:
            fail(f"[{section}] has unknown field(s) {sorted(extra)}; allowed: {sorted(allowed)}")
    extra = set(service) - SERVICE_FIELDS
    if extra:
        fail(f"[service] has unknown field(s) {sorted(extra)}; allowed: {sorted(SERVICE_FIELDS)}")

    slug = service.get("slug")
    # The slug feeds every derived name; the 34-char ceiling keeps the account-
    # suffixed state bucket within S3's 63-char limit (29 chars of scaffold).
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug) or len(slug) > 34:
        fail(f"slug {slug!r} must be 34 or fewer lowercase digits/hyphens, e.g. document-parser")

    region = service.get("region")
    if region is not None and (not isinstance(region, str) or not REGION_RE.fullmatch(region)):
        fail(f"region {region!r} must be a plain region code, e.g. ap-southeast-2")

    window = service.get("recovery_window")
    if window is not None:
        if not isinstance(window, int) or isinstance(window, bool):
            fail("recovery_window must be a whole number of days")
        elif window != 0 and not RECOVERY_WINDOW_MIN <= window <= RECOVERY_WINDOW_MAX:
            fail(
                f"recovery_window must be 0 or between {RECOVERY_WINDOW_MIN} and {RECOVERY_WINDOW_MAX}"
            )

    raw_keys = secrets.get("keys")
    if not isinstance(raw_keys, list) or not raw_keys:
        fail("[secrets] needs a non-empty keys list (the blob contract)")
        return errors
    blob_keys: list[str] = []
    for key in raw_keys:
        if not isinstance(key, str) or not PLANE_KEY_RE.fullmatch(key):
            fail(f"secret key {key!r} must be a plain env-style name, e.g. API_KEY")
        elif key in blob_keys:
            fail(f"secret key {key!r} is listed twice")
        else:
            blob_keys.append(key)
    for duplicate in set(blob_keys) & set(ssm.get("keys", []) or []):
        fail(
            f"{duplicate} is seeded into both planes (Secrets blob and SSM); "
            "the planes are disjoint by design"
        )

    min_lengths = secrets.get("min_lengths", {})
    if isinstance(min_lengths, dict):
        for key, floor in min_lengths.items():
            if key not in blob_keys:
                fail(f"min_lengths names {key!r} which is not a [secrets] key")
            elif isinstance(floor, bool) or not isinstance(floor, int) or floor < 1:
                fail(f"min_lengths[{key!r}] must be a positive whole number")

    ssm_keys = ssm.get("keys", [])
    if not isinstance(ssm_keys, list):
        fail("[ssm] keys must be a list")
        ssm_keys = []
    else:
        for key in ssm_keys:
            if not isinstance(key, str) or not PLANE_KEY_RE.fullmatch(key):
                fail(f"ssm key {key!r} must be a plain env-style name, e.g. UPLOAD_LIMIT_BYTES")

    for trigger, pair in sections["requires"].items():
        target_key, floor = pair if isinstance(pair, list) and len(pair) == 2 else (None, None)
        if target_key not in blob_keys:
            fail(f"requires[{trigger!r}] must pair with a [secrets] key, got {target_key!r}")
        elif isinstance(floor, bool) or not isinstance(floor, int) or floor < 1:
            fail(f"requires[{trigger!r}] floor must be a positive whole number")
        if trigger not in set(blob_keys) | set(ssm_keys):
            fail(f"requires[{trigger!r}] triggers on {trigger!r} which is never seeded")
    return errors
