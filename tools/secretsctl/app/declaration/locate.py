"""Workspace discovery: the repo root and locating a service's files."""

from __future__ import annotations

from pathlib import Path

from app.declaration.model import Workspace
from app.shell import die

REPO_ROOT = Path(__file__).resolve().parents[4]


def workspace_for(service_dir: Path, values_file: Path | None = None) -> Workspace:
    values = values_file or service_dir / "infra" / ".env"
    return Workspace(
        service_dir=service_dir,
        values_file=values,
    )


def find_service_workspace(repo_root: Path, service: str | None) -> Workspace:
    if service is not None:
        service_dir = repo_root / "services" / service
        if not (service_dir / "secrets.toml").exists():
            die(
                f"no secrets.toml found in {service_dir}",
                "add one to the service root (see the secretsctl README)",
            )
        return workspace_for(service_dir)
    for candidate in (Path.cwd(), *Path.cwd().parents):
        if (candidate / "secrets.toml").exists():
            return workspace_for(candidate)
    die(
        "no secrets.toml found from the current directory upward",
        "run the tool inside a service directory or pass --service <name>",
    )


def ready_service_workspaces(repo_root: Path) -> list[Workspace]:
    """Every service runnable right now: a committed secrets.toml plus its
    infra/.env. Services missing either are not batch candidates (the
    single-service verbs die with their own hints). Sorted by service name."""
    services_root = repo_root / "services"
    if not services_root.is_dir():
        return []
    declared = sorted(
        (
            candidate
            for candidate in services_root.iterdir()
            if (candidate / "secrets.toml").exists()
        ),
        key=lambda service_dir: service_dir.name,
    )
    return [
        workspace for workspace in map(workspace_for, declared) if workspace.values_file.exists()
    ]
