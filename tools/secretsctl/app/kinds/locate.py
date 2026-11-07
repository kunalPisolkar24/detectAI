"""Stack discovery: the repo root, locating a stack's files, and batch targets.

The declaration filenames are the registry's kind switch: which file a
directory holds decides which flavor drives it."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.engine.shell import die
from app.kinds import KINDS, Kind

REPO_ROOT = Path(__file__).resolve().parents[4]


@dataclass
class Workspace:
    """One stack's two files: its directory (the declaration sits there, the
    kind decides its name) and the values file."""

    kind: Kind
    stack_dir: Path
    values_file: Path

    @property
    def declaration_file(self) -> Path:
        return self.stack_dir / self.kind.declaration_filename


def workspace_for(kind: Kind, stack_dir: Path, values_file: Path | None = None) -> Workspace:
    return Workspace(
        kind=kind,
        stack_dir=stack_dir,
        values_file=values_file or stack_dir / kind.values_relpath,
    )


def _kind_for_filename(filename: str) -> Kind:
    kind = next((item for item in KINDS.values() if item.declaration_filename == filename), None)
    if kind is None:
        die(f"unregistered declaration filename: {filename}", "register the kind in app/main.py")
    return kind


def find_service_workspace(repo_root: Path, service: str | None) -> Workspace:
    if service is not None:
        stack_dir = repo_root / "services" / service
        declared = [
            kind for kind in KINDS.values() if (stack_dir / kind.declaration_filename).exists()
        ]
        if not declared:
            die(
                f"no {_known_names()[0]} found in {stack_dir}",
                "add one to the service root (see the secretsctl README)",
            )
        return workspace_for(declared[0], stack_dir)
    for candidate in (Path.cwd(), *Path.cwd().parents):
        found = [name for name in _known_names() if (candidate / name).exists()]
        if found:
            return workspace_for(_kind_for_filename(found[0]), candidate)
    die(
        f"no {_known_names()[0]} found from the current directory upward",
        "run the tool inside a service directory or pass --service <name>",
    )


def _known_names() -> list[str]:
    return [kind.declaration_filename for kind in KINDS.values()]


def ready_service_workspaces(repo_root: Path) -> list[Workspace]:
    """Every service runnable right now: a committed declaration plus its
    kind's values file. Services missing either are not batch candidates (the
    single-service verbs die with their own hints). Sorted by service name."""
    services_root = repo_root / "services"
    if not services_root.is_dir():
        return []
    declared = sorted(
        (
            (candidate, kind)
            for candidate in services_root.iterdir()
            for kind in KINDS.values()
            if (candidate / kind.declaration_filename).exists()
        ),
        key=lambda pair: pair[0].name,
    )
    return [
        workspace
        for workspace in (workspace_for(kind, stack_dir) for stack_dir, kind in declared)
        if workspace.values_file.exists()
    ]
