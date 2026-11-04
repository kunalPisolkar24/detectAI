"""Service declarations: secrets.toml loading, validation, and derived names."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

DEFAULT_REGION = "ap-southeast-2"
DEFAULT_RECOVERY_WINDOW = 30

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
PLANE_KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")

RECOVERY_WINDOW_MIN = 7
RECOVERY_WINDOW_MAX = 30

TOP_SECTIONS = {"service", "state", "secrets", "ssm", "requires"}
SERVICE_FIELDS = {"slug", "region", "recovery_window"}
STATE_FIELDS = {"emulator_default"}
SECRETS_FIELDS = {"keys", "min_lengths"}
SSM_FIELDS = {"keys"}


class DeclarationError(Exception):
    pass


def secret_name(slug: str) -> str:
    return f"detectai/{slug}/secrets"


def ssm_prefix_for(slug: str) -> str:
    return f"/detectai/{slug}/"


def seeder_role_for(slug: str) -> str:
    return f"detectai-{slug}-seeder"


def derived_emulator_bucket(slug: str) -> str:
    return f"detectai-{slug}-tfstate"


@dataclass
class Declaration:
    slug: str
    secret_name: str
    ssm_prefix: str
    blob_keys: tuple[str, ...]
    ssm_keys: tuple[str, ...]
    min_lengths: dict[str, int]
    requires: dict[str, tuple[str, int]]
    seeder_role_name: str
    emulator_bucket: str
    region_default: str
    recovery_window: int


@dataclass
class Workspace:
    service_dir: Path
    values_file: Path
    session_cache: Path
    tf_dir: Path


def workspace_for(service_dir: Path, values_file: Path | None = None) -> Workspace:
    values = values_file or service_dir / "infra" / ".env"
    return Workspace(
        service_dir=service_dir,
        values_file=values,
        session_cache=values.parent / ".aws-session.json",
        tf_dir=service_dir / "infra" / "terraform",
    )


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

    for section, allowed in (
        ("state", STATE_FIELDS),
        ("secrets", SECRETS_FIELDS),
        ("ssm", SSM_FIELDS),
    ):
        extra = set(data.get(section, {})) - allowed
        if extra:
            fail(f"[{section}] has unknown field(s) {sorted(extra)}; allowed: {sorted(allowed)}")
    if "requires" in data and not isinstance(data["requires"], dict):
        fail("[requires] must be a table")
    extra = set(service) - SERVICE_FIELDS
    if extra:
        fail(f"[service] has unknown field(s) {sorted(extra)}; allowed: {sorted(SERVICE_FIELDS)}")

    slug = service.get("slug")
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
        fail(f"slug {slug!r} must be lowercase digits/hyphens, e.g. document-parser")

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

    state = data.get("state", {})
    emulator_default = state.get("emulator_default")
    if emulator_default is not None and (
        not isinstance(emulator_default, str) or not BUCKET_RE.fullmatch(emulator_default)
    ):
        fail(f"emulator_default {emulator_default!r} is not a valid S3 bucket name")

    secrets = data.get("secrets", {})
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
    for duplicate in set(blob_keys) & set(data.get("ssm", {}).get("keys", []) or []):
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

    ssm_keys = data.get("ssm", {}).get("keys", [])
    if not isinstance(ssm_keys, list):
        fail("[ssm] keys must be a list")
        ssm_keys = []
    else:
        for key in ssm_keys:
            if not isinstance(key, str) or not PLANE_KEY_RE.fullmatch(key):
                fail(f"ssm key {key!r} must be a plain env-style name, e.g. UPLOAD_LIMIT_BYTES")

    for trigger, pair in (data.get("requires") or {}).items():
        target_key, floor = pair if isinstance(pair, list) and len(pair) == 2 else (None, None)
        if target_key not in blob_keys:
            fail(f"requires[{trigger!r}] must pair with a [secrets] key, got {target_key!r}")
        elif isinstance(floor, bool) or not isinstance(floor, int) or floor < 1:
            fail(f"requires[{trigger!r}] floor must be a positive whole number")
        if trigger not in set(blob_keys) | set(ssm_keys):
            fail(f"requires[{trigger!r}] triggers on {trigger!r} which is never seeded")
    return errors


def load(toml_path: Path) -> Declaration:
    try:
        data = tomllib.loads(toml_path.read_text())
    except (tomllib.TOMLDecodeError, OSError) as exc:
        raise DeclarationError(f"cannot read {toml_path}: {exc}") from exc
    errors = declaration_errors(data)
    if errors:
        raise DeclarationError("\n".join(errors))

    service = data["service"]
    slug: str = service["slug"]
    blob_keys = tuple(data.get("secrets", {}).get("keys", []))
    min_lengths = dict(data.get("secrets", {}).get("min_lengths", {}))
    requires = {
        trigger: (pair[0], int(pair[1])) for trigger, pair in data.get("requires", {}).items()
    }
    emulator_bucket = data.get("state", {}).get("emulator_default") or derived_emulator_bucket(slug)
    return Declaration(
        slug=slug,
        secret_name=secret_name(slug),
        ssm_prefix=ssm_prefix_for(slug),
        blob_keys=blob_keys,
        ssm_keys=tuple(data.get("ssm", {}).get("keys", [])),
        min_lengths=min_lengths,
        requires=requires,
        seeder_role_name=seeder_role_for(slug),
        emulator_bucket=emulator_bucket,
        region_default=service.get("region", DEFAULT_REGION),
        recovery_window=service.get("recovery_window", DEFAULT_RECOVERY_WINDOW),
    )
