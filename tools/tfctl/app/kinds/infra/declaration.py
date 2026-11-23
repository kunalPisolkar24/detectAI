"""The infra stack's declaration: the fabric ledgers described by infra.toml."""

from __future__ import annotations

import re
from dataclasses import dataclass
from math import floor
from pathlib import Path
from tomllib import TOMLDecodeError

from app.engine.declaration.model import REGION_RE, Declaration, DeclarationError, seeder_role_for
from app.engine.declaration.parse import parse_declaration

SLUG = "infra"
REGION_DEFAULT = "ap-southeast-2"

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TOP_SECTIONS = {"service", "queues", "elasticache", "atlas", "aurora"}
SERVICE_FIELDS = {"slug", "region"}
QUEUE_FIELDS = {"name", "dlq", "max_receive_count"}
AURORA_FIELDS = {
    "name",
    "engine",
    "engine_version",
    "database_name",
    "port",
    "min_acu",
    "max_acu",
    "num_read_replicas",
    "storage_encrypted",
    "backup_retention_days",
    "deletion_protection",
    "skip_final_snapshot",
}
CACHE_FIELDS = {
    "name",
    "engine",
    "major_engine_version",
    "max_data_storage_gb",
    "max_ecpu_per_second",
}
ATLAS_FIELDS = {"name", "region", "tier"}

# FIFO queue name law: [A-Za-z0-9_-] up to 75 chars plus the .fifo suffix.
QUEUE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,75}\.fifo$")
MAX_RECEIVE_COUNT_LIMIT = 1000

CACHE_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
CACHE_MAJOR_VERSION_RE = re.compile(r"^[0-9]+$")
ATLAS_REGION_RE = re.compile(r"^[A-Z]{2}_[A-Z]+_[0-9]+$")
ATLAS_TIER = "M0"
CACHE_ENGINE = "redis"
CACHE_MAJOR_VERSION_DEFAULT = "7"
CACHE_STORAGE_GB_DEFAULT = 5
CACHE_ECPU_DEFAULT = 5000
CACHE_STORAGE_GB_MIN = 1
CACHE_STORAGE_GB_MAX = 5000
CACHE_ECPU_MIN = 1000
CACHE_ECPU_MAX = 15000000
AURORA_ENGINE = "aurora-postgresql"
AURORA_ENGINE_VERSION_DEFAULT = "16.4"
AURORA_VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+(?:\.[0-9]+)?$")
AURORA_PORT_DEFAULT = 5432
AURORA_MIN_ACU = 0.5
AURORA_MAX_ACU = 128
AURORA_BACKUP_DAYS_DEFAULT = 7


@dataclass
class QueueEntry:
    """One declared queue: its name is the identity; the dlq/redrive pair is optional."""

    name: str
    dlq: str
    max_receive_count: int


@dataclass
class CacheEntry:
    """One declared ElastiCache Serverless cache: the name is the identity."""

    name: str
    engine: str
    major_engine_version: str
    max_data_storage_gb: int
    max_ecpu_per_second: int


@dataclass
class AtlasEntry:
    """One declared Atlas Free cluster; the name is the identity."""

    name: str
    region: str
    tier: str


@dataclass
class AuroraEntry:
    """One declared Aurora Serverless v2 cluster; the name is the identity."""

    name: str
    engine: str
    engine_version: str
    database_name: str
    port: int
    min_acu: float
    max_acu: float
    num_read_replicas: int
    storage_encrypted: bool
    backup_retention_days: int
    deletion_protection: bool
    skip_final_snapshot: bool


@dataclass
class InfraDeclaration(Declaration):
    """The engine-facing face of the fabric: all declared ledgers ride along."""

    queue_ledger: tuple[QueueEntry, ...] = ()
    cache_ledger: tuple[CacheEntry, ...] = ()
    atlas_ledger: tuple[AtlasEntry, ...] = ()
    aurora_ledger: tuple[AuroraEntry, ...] = ()


def declaration_errors(data: dict) -> list[str]:
    errors: list[str] = []

    def fail(message: str) -> None:
        errors.append(f"error: infra.toml — {message}")

    unknown = set(data) - TOP_SECTIONS
    if unknown:
        fail(f"unknown section(s) {sorted(unknown)}; allowed: {sorted(TOP_SECTIONS)}")
    service = data.get("service")
    if not isinstance(service, dict):
        fail("[service] is required")
        return errors

    extra = set(service) - SERVICE_FIELDS
    if extra:
        fail(f"[service] has unknown field(s) {sorted(extra)}; allowed: {sorted(SERVICE_FIELDS)}")

    slug = service.get("slug")
    if slug != SLUG:
        fail(
            f'slug must be "{SLUG}" (the state keys and the seeder role derive from it), '
            f"got {slug!r}"
        )

    region = service.get("region")
    if region is not None and (not isinstance(region, str) or not REGION_RE.fullmatch(region)):
        fail(f"region {region!r} must be a plain region code, e.g. {REGION_DEFAULT}")

    entries = data.get("queues", [])
    if not isinstance(entries, list):
        fail("[queues] must be a list of [[queues]] entries")
        entries = []

    caches = data.get("elasticache", [])
    if not isinstance(caches, list):
        fail("[elasticache] must be a list of [[elasticache]] entries")
        caches = []

    atlas = data.get("atlas", [])
    if not isinstance(atlas, list):
        fail("[atlas] must be a list of [[atlas]] entries")
        atlas = []

    aurora = data.get("aurora", [])
    if not isinstance(aurora, list):
        fail("[aurora] must be a list of [[aurora]] entries")
        aurora = []

    if not entries and not caches and not atlas and not aurora:
        fail(
            "declare at least one fabric: [[queues]], [[elasticache]], "
            "[[atlas]] and/or [[aurora]]"
        )

    declared: set[str] = set()
    valid: list[tuple[dict, str]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            fail("every [[queues]] entry must be a table")
            continue
        extra = set(entry) - QUEUE_FIELDS
        if extra:
            fail(
                f"[[queues]] has unknown field(s) {sorted(extra)}; allowed: {sorted(QUEUE_FIELDS)}"
            )
        name = entry.get("name")
        if not isinstance(name, str) or not QUEUE_NAME_RE.fullmatch(name):
            fail(
                f"queue name {name!r} must be a FIFO name: [A-Za-z0-9_-]{{1,75}} ending in '.fifo'"
            )
            continue
        if name in declared:
            fail(f"{name} is declared twice; the name is the identity — declare it once")
            continue
        declared.add(name)
        valid.append((entry, name))

    for entry, name in valid:
        dlq = entry.get("dlq", "")
        if dlq == "" and entry.get("max_receive_count", 0) != 0:
            fail(
                f"{name} declares no dlq; max_receive_count is meaningless — "
                "remove it or add a dlq"
            )
        if not isinstance(dlq, str) or (dlq and not QUEUE_NAME_RE.fullmatch(dlq)):
            fail(f"dlq {dlq!r} must be a FIFO name: [A-Za-z0-9_-]{{1,75}} ending in '.fifo'")
            continue
        if not dlq:
            continue
        if dlq == name:
            fail(f"{name} redrives to itself; point dlq at a different queue in the ledger")
            continue
        if dlq not in declared:
            fail(
                f"{name} redrives to {dlq!r}, which is not declared; "
                "the ledger is exhaustive — declare it in its own [[queues]] entry"
            )
            continue
        receive = entry.get("max_receive_count", 0)
        if "max_receive_count" not in entry:
            fail(
                f"{name} redrives to {dlq!r}; max_receive_count "
                f"(1-{MAX_RECEIVE_COUNT_LIMIT}) is required"
            )
        elif (
            isinstance(receive, bool)
            or not isinstance(receive, int)
            or not 1 <= receive <= MAX_RECEIVE_COUNT_LIMIT
        ):
            fail(
                f"{name} max_receive_count must be an integer 1-{MAX_RECEIVE_COUNT_LIMIT}, "
                f"got {receive!r}"
            )

    # Redrive targets must be terminal: the terraform fabric splits into two
    # resource classes by that law, so a DLQ of its own would be unstateable.
    targets = {entry.get("dlq", "") for entry, _ in valid} - {""}
    for entry, name in valid:
        if name in targets and entry.get("dlq", ""):
            fail(
                f"{name} is itself a redrive target; DLQ chains are not modeled — "
                "leave its dlq empty"
            )

    cache_declared: set[str] = set()
    for entry in caches:
        if not isinstance(entry, dict):
            fail("every [[elasticache]] entry must be a table")
            continue
        extra = set(entry) - CACHE_FIELDS
        if extra:
            fail(
                f"[[elasticache]] has unknown field(s) {sorted(extra)}; "
                f"allowed: {sorted(CACHE_FIELDS)}"
            )
        name = entry.get("name")
        if not isinstance(name, str) or not CACHE_NAME_RE.fullmatch(name):
            fail(
                f"cache name {name!r} must be a lowercase DNS-style name: "
                "[a-z][a-z0-9-]{0,39}"
            )
            continue
        if name in cache_declared:
            fail(f"{name} is declared twice; the name is the identity — declare it once")
            continue
        cache_declared.add(name)

        engine = entry.get("engine", CACHE_ENGINE)
        if engine != CACHE_ENGINE:
            fail(f"{name} engine {engine!r} must be {CACHE_ENGINE!r}")
        version = entry.get("major_engine_version", CACHE_MAJOR_VERSION_DEFAULT)
        if not isinstance(version, str) or not CACHE_MAJOR_VERSION_RE.fullmatch(version):
            fail(f"{name} major_engine_version {version!r} must be a major version, e.g. 7")
        storage = entry.get("max_data_storage_gb", CACHE_STORAGE_GB_DEFAULT)
        if (
            isinstance(storage, bool)
            or not isinstance(storage, int)
            or not CACHE_STORAGE_GB_MIN <= storage <= CACHE_STORAGE_GB_MAX
        ):
            fail(
                f"{name} max_data_storage_gb must be an integer "
                f"{CACHE_STORAGE_GB_MIN}-{CACHE_STORAGE_GB_MAX}, got {storage!r}"
            )
        ecpu = entry.get("max_ecpu_per_second", CACHE_ECPU_DEFAULT)
        if (
            isinstance(ecpu, bool)
            or not isinstance(ecpu, int)
            or not CACHE_ECPU_MIN <= ecpu <= CACHE_ECPU_MAX
        ):
            fail(
                f"{name} max_ecpu_per_second must be an integer "
                f"{CACHE_ECPU_MIN}-{CACHE_ECPU_MAX}, got {ecpu!r}"
            )

    atlas_declared: set[str] = set()
    for entry in atlas:
        if not isinstance(entry, dict):
            fail("every [[atlas]] entry must be a table")
            continue
        extra = set(entry) - ATLAS_FIELDS
        if extra:
            fail(
                f"[[atlas]] has unknown field(s) {sorted(extra)}; allowed: {sorted(ATLAS_FIELDS)}"
            )
        name = entry.get("name")
        if not isinstance(name, str) or not CACHE_NAME_RE.fullmatch(name):
            fail(
                f"atlas name {name!r} must be a lowercase DNS-style name: [a-z][a-z0-9-]{{0,39}}"
            )
            continue
        if name in atlas_declared:
            fail(f"{name} is declared twice; the name is the identity — declare it once")
            continue
        atlas_declared.add(name)
        region = entry.get("region")
        if not isinstance(region, str) or not ATLAS_REGION_RE.fullmatch(region):
            fail(
                f"{name} region {region!r} must be an Atlas region name, e.g. AP_SOUTHEAST_2"
            )
        tier = entry.get("tier", ATLAS_TIER)
        if tier != ATLAS_TIER:
            fail(f"{name} tier {tier!r} must be {ATLAS_TIER!r} (the free tier is the only option)")

    aurora_declared: set[str] = set()
    for entry in aurora:
        if not isinstance(entry, dict):
            fail("every [[aurora]] entry must be a table")
            continue
        extra = set(entry) - AURORA_FIELDS
        if extra:
            fail(
                f"[[aurora]] has unknown field(s) {sorted(extra)}; "
                f"allowed: {sorted(AURORA_FIELDS)}"
            )
        name = entry.get("name")
        if not isinstance(name, str) or not CACHE_NAME_RE.fullmatch(name):
            fail(
                f"aurora name {name!r} must be a lowercase DNS-style name: "
                "[a-z][a-z0-9-]{0,39}"
            )
            continue
        if name in aurora_declared:
            fail(f"{name} is declared twice; the name is the identity — declare it once")
            continue
        aurora_declared.add(name)

        engine = entry.get("engine", AURORA_ENGINE)
        if engine != AURORA_ENGINE:
            fail(f"{name} engine {engine!r} must be {AURORA_ENGINE!r}")
        version = entry.get("engine_version", AURORA_ENGINE_VERSION_DEFAULT)
        if not isinstance(version, str) or not AURORA_VERSION_RE.fullmatch(version):
            fail(f"{name} engine_version {version!r} must look like a version, e.g. 16.4")
        database = entry.get("database_name")
        if not isinstance(database, str) or not re.fullmatch(
            r"[A-Za-z][A-Za-z0-9_]{0,62}", database or ""
        ):
            fail(f"{name} database_name {database!r} must be a plain SQL identifier")
        port = entry.get("port", AURORA_PORT_DEFAULT)
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            fail(f"{name} port must be an integer 1-65535, got {port!r}")
        for label in ("min_acu", "max_acu"):
            value = entry.get(label)
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not AURORA_MIN_ACU <= value <= AURORA_MAX_ACU
                or value * 2 != floor(value * 2)
            ):
                fail(
                    f"{name} {label} must be a number "
                    f"{AURORA_MIN_ACU}-{AURORA_MAX_ACU} in 0.5 steps, got {value!r}"
                )
        minimum, maximum = entry.get("min_acu"), entry.get("max_acu")
        if (
            isinstance(minimum, (int, float))
            and not isinstance(minimum, bool)
            and isinstance(maximum, (int, float))
            and not isinstance(maximum, bool)
            and minimum > maximum
        ):
            fail(f"{name} min_acu {minimum} exceeds max_acu {maximum}")
        replicas = entry.get("num_read_replicas", 0)
        if isinstance(replicas, bool) or not isinstance(replicas, int) or replicas < 0:
            fail(f"{name} num_read_replicas must be a non-negative integer, got {replicas!r}")
        backup = entry.get("backup_retention_days", AURORA_BACKUP_DAYS_DEFAULT)
        if isinstance(backup, bool) or not isinstance(backup, int) or not 1 <= backup <= 35:
            fail(f"{name} backup_retention_days must be an integer 1-35, got {backup!r}")
        for flag in ("storage_encrypted", "deletion_protection", "skip_final_snapshot"):
            value = entry.get(flag, flag == "storage_encrypted")
            if not isinstance(value, bool):
                fail(f"{name} {flag} must be a boolean, got {value!r}")
    return errors


def load(toml_path: Path) -> InfraDeclaration:
    try:
        data = parse_declaration(toml_path)
    except (TOMLDecodeError, OSError) as exc:
        raise DeclarationError(f"cannot read {toml_path}: {exc}") from exc
    errors = declaration_errors(data)
    if errors:
        raise DeclarationError("\n".join(errors))
    service = data["service"]
    return InfraDeclaration(
        kind="infra",
        slug=SLUG,
        seeder_role_name=seeder_role_for(SLUG),
        region_default=service.get("region", REGION_DEFAULT),
        stack_root=toml_path.resolve().parent / "terraform",
        queue_ledger=tuple(
            QueueEntry(
                name=entry["name"],
                dlq=entry.get("dlq", ""),
                max_receive_count=entry.get("max_receive_count", 0),
            )
            for entry in data.get("queues", [])
        ),
        cache_ledger=tuple(
            CacheEntry(
                name=entry["name"],
                engine=entry.get("engine", CACHE_ENGINE),
                major_engine_version=entry.get(
                    "major_engine_version", CACHE_MAJOR_VERSION_DEFAULT
                ),
                max_data_storage_gb=entry.get("max_data_storage_gb", CACHE_STORAGE_GB_DEFAULT),
                max_ecpu_per_second=entry.get("max_ecpu_per_second", CACHE_ECPU_DEFAULT),
            )
            for entry in data.get("elasticache", [])
        ),
        atlas_ledger=tuple(
            AtlasEntry(
                name=entry["name"],
                region=entry["region"],
                tier=entry.get("tier", ATLAS_TIER),
            )
            for entry in data.get("atlas", [])
        ),
        aurora_ledger=tuple(
            AuroraEntry(
                name=entry["name"],
                engine=entry.get("engine", AURORA_ENGINE),
                engine_version=entry.get("engine_version", AURORA_ENGINE_VERSION_DEFAULT),
                database_name=entry["database_name"],
                port=entry.get("port", AURORA_PORT_DEFAULT),
                min_acu=entry["min_acu"],
                max_acu=entry["max_acu"],
                num_read_replicas=entry.get("num_read_replicas", 0),
                storage_encrypted=entry.get("storage_encrypted", True),
                backup_retention_days=entry.get(
                    "backup_retention_days", AURORA_BACKUP_DAYS_DEFAULT
                ),
                deletion_protection=entry.get("deletion_protection", False),
                skip_final_snapshot=entry.get("skip_final_snapshot", False),
            )
            for entry in data.get("aurora", [])
        ),
    )
