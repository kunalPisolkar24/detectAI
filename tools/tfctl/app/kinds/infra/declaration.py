"""The infra stack's declaration: the fabric ledgers described by infra.toml."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from app.engine.declaration.model import REGION_RE, Declaration, DeclarationError, seeder_role_for

SLUG = "infra"
REGION_DEFAULT = "ap-southeast-2"

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TOP_SECTIONS = {"service", "queues", "elasticache"}
SERVICE_FIELDS = {"slug", "region"}
QUEUE_FIELDS = {"name", "dlq", "max_receive_count"}
CACHE_FIELDS = {
    "name",
    "engine",
    "engine_version",
    "node_type",
    "num_cache_nodes",
    "port",
    "parameter_group_name",
}

# FIFO queue name law: [A-Za-z0-9_-] up to 75 chars plus the .fifo suffix.
QUEUE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,75}\.fifo$")
MAX_RECEIVE_COUNT_LIMIT = 1000

CACHE_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
CACHE_VERSION_RE = re.compile(r"^[0-9]+(?:\.[0-9]+){1,2}$")
CACHE_NODE_TYPE_RE = re.compile(r"^cache\.[a-z0-9]+\.[a-z0-9]+$")
CACHE_ENGINE = "redis"
CACHE_VERSION_DEFAULT = "7.0"
CACHE_NODE_TYPE_DEFAULT = "cache.t3.micro"
CACHE_NODES_DEFAULT = 1
CACHE_PORT_DEFAULT = 6379


def default_parameter_group(version: str) -> str:
    if version.startswith("7."):
        return "default.redis7"
    if version.startswith("6."):
        return "default.redis6.x"
    if version.startswith("5."):
        return "default.redis5.0"
    return "default.redis7"


@dataclass
class QueueEntry:
    """One declared queue: its name is the identity; the dlq/redrive pair is optional."""

    name: str
    dlq: str
    max_receive_count: int


@dataclass
class CacheEntry:
    """One declared ElastiCache cluster: the name is the identity."""

    name: str
    engine: str
    engine_version: str
    node_type: str
    num_cache_nodes: int
    port: int
    parameter_group_name: str


@dataclass
class InfraDeclaration(Declaration):
    """The engine-facing face of the fabric: both ledgers ride along."""

    queue_ledger: tuple[QueueEntry, ...] = ()
    cache_ledger: tuple[CacheEntry, ...] = ()


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

    if not entries and not caches:
        fail("declare at least one fabric: [[queues]] and/or [[elasticache]]")

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
        version = entry.get("engine_version", CACHE_VERSION_DEFAULT)
        if not isinstance(version, str) or not CACHE_VERSION_RE.fullmatch(version):
            fail(f"{name} engine_version {version!r} must look like a version, e.g. 7.0")
        node_type = entry.get("node_type", CACHE_NODE_TYPE_DEFAULT)
        if not isinstance(node_type, str) or not CACHE_NODE_TYPE_RE.fullmatch(node_type):
            fail(
                f"{name} node_type {node_type!r} must be an ElastiCache node type, "
                f"e.g. {CACHE_NODE_TYPE_DEFAULT}"
            )
        nodes = entry.get("num_cache_nodes", CACHE_NODES_DEFAULT)
        if isinstance(nodes, bool) or not isinstance(nodes, int) or not 1 <= nodes <= 6:
            fail(f"{name} num_cache_nodes must be an integer 1-6, got {nodes!r}")
        port = entry.get("port", CACHE_PORT_DEFAULT)
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            fail(f"{name} port must be an integer 1-65535, got {port!r}")
        group = entry.get("parameter_group_name", default_parameter_group(str(version)))
        if not isinstance(group, str) or not group:
            fail(f"{name} parameter_group_name must be a non-empty string, got {group!r}")
    return errors


def load(toml_path: Path) -> InfraDeclaration:
    try:
        data = tomllib.loads(toml_path.read_text())
    except (tomllib.TOMLDecodeError, OSError) as exc:
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
                engine_version=entry.get("engine_version", CACHE_VERSION_DEFAULT),
                node_type=entry.get("node_type", CACHE_NODE_TYPE_DEFAULT),
                num_cache_nodes=entry.get("num_cache_nodes", CACHE_NODES_DEFAULT),
                port=entry.get("port", CACHE_PORT_DEFAULT),
                parameter_group_name=entry.get(
                    "parameter_group_name",
                    default_parameter_group(entry.get("engine_version", CACHE_VERSION_DEFAULT)),
                ),
            )
            for entry in data.get("elasticache", [])
        ),
    )
