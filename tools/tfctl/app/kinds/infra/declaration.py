"""The infra stack's declaration: the queue fabric ledger described by infra.toml."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass
from pathlib import Path

from app.engine.declaration.model import REGION_RE, Declaration, DeclarationError, seeder_role_for

SLUG = "infra"
REGION_DEFAULT = "eu-central-1"

SLUG_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
TOP_SECTIONS = {"service", "queues"}
SERVICE_FIELDS = {"slug", "region"}
QUEUE_FIELDS = {"name", "dlq", "max_receive_count"}

# FIFO queue name law: [A-Za-z0-9_-] up to 75 chars plus the .fifo suffix.
QUEUE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,75}\.fifo$")
MAX_RECEIVE_COUNT_LIMIT = 1000


@dataclass
class QueueEntry:
    """One declared queue: its name is the identity; the dlq/redrive pair is optional."""

    name: str
    dlq: str
    max_receive_count: int


@dataclass
class InfraDeclaration(Declaration):
    """The engine-facing face of the queue fabric: the ledger rides along."""

    queue_ledger: tuple[QueueEntry, ...] = ()


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

    entries = data.get("queues")
    if not isinstance(entries, list) or not entries:
        fail("[queues] must list every queue the fabric owns (at least one [[queues]] entry)")
        return errors

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
            for entry in data["queues"]
        ),
    )
