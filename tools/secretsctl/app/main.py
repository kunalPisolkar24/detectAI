"""Verb entry point: argument parsing, service resolution, and verb dispatch.

main.py is the composition root by being the caller: every flow gets wired
here, while each verb's mechanics live in its own subpackage.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from app.carrier.role import drop_seeder_flow, validate_seeder_role
from app.carrier.session import clear_cached_session, resolve_carrier_session
from app.declaration.loader import DeclarationError, load
from app.declaration.locate import REPO_ROOT, find_service_workspace, workspace_for
from app.shell import die
from app.stack.flow import terraform_verb_flow
from app.verify import flow as verify
from app.values.parse import parse_env_file
from app.values.plane import resolve_plane
from app.values.rules import plane_errors, validate

VERBS = (
    "plan",
    "apply",
    "verify",
    "destroy",
    "seeder-drop",
    "session-clear",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="secretsctl",
        description="Validate a service's .env against its secrets.toml and drive the secrets stack.",
    )
    parser.add_argument(
        "command",
        choices=VERBS,
        help="terraform plan/apply/destroy and verify, with the state bucket and seeder "
        "role created on demand on both planes; seeder-drop detaches and deletes the "
        "seeder role; session-clear drops the cached seeder session file",
    )
    parser.add_argument(
        "--service",
        help="service name under <repo root>/services (default: nearest secrets.toml upward)",
    )
    plane_group = parser.add_mutually_exclusive_group()
    plane_group.add_argument(
        "--floci",
        action="store_true",
        help="run against the Floci emulator (the default plane; explicit for scripts)",
    )
    plane_group.add_argument(
        "--aws",
        action="store_true",
        help="run against real AWS (the seeder role session, MFA-gated)",
    )
    parser.add_argument(
        "--values-file", help="alternate values file (default: the service's infra/.env)"
    )
    parser.add_argument(
        "--purge-state",
        action="store_true",
        help="destroy only: after terraform destroy, wipe and delete the plane's state bucket",
    )
    parser.add_argument(
        "--force-delete",
        action="store_true",
        help="destroy only: delete the secret immediately after destroy, skipping the recovery window on real AWS",
    )
    parser.add_argument(
        "--drop-seeder",
        action="store_true",
        help="destroy only: after terraform destroy, drop the out-of-stack seeder role "
        "(detach its inline policy, then delete the role)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print everything that would be fed to terraform; run nothing",
    )
    return parser


def main(argv: list[str] | None = None, workspace=None) -> int:
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.purge_state and args.command != "destroy":
        die("--purge-state only applies to the destroy command", "run it with destroy")
    if args.force_delete and args.command != "destroy":
        die("--force-delete only applies to the destroy command", "run it with destroy")
    if args.drop_seeder and args.command != "destroy":
        die("--drop-seeder only applies to the destroy command", "run it with destroy")

    if workspace is None:
        workspace = find_service_workspace(REPO_ROOT, args.service)
    if args.values_file:
        workspace = workspace_for(workspace.service_dir, Path(args.values_file))

    if args.command == "session-clear":
        if clear_cached_session(workspace.session_cache):
            print(f"removed: {workspace.session_cache}")
        else:
            print("nothing to clear (no cached seeder session)")
        return 0

    try:
        declaration = load(workspace.service_dir / "secrets.toml")
    except DeclarationError as exc:
        die(str(exc), "fix the service's secrets.toml")
    if not workspace.values_file.exists():
        die(
            f"{workspace.values_file} not found",
            "create the service's infra/.env first (copy its committed .env.example)",
        )
    values = parse_env_file(workspace.values_file)
    if "EMULATOR_ENDPOINT" in values:
        print(
            "note: EMULATOR_ENDPOINT in the values file is ignored; "
            "the plane comes from --aws/--floci (default: floci)"
        )
    plane, is_emulator = resolve_plane(args.aws)

    if args.command == "seeder-drop":
        errors = validate_seeder_role(declaration, values, is_emulator)
        for error in errors:
            print(error)
        if errors:
            return 1
        return drop_seeder_flow(declaration, values, is_emulator, args.dry_run)

    if args.command == "verify":
        errors = plane_errors(values)
        for error in errors:
            print(error)
        if errors:
            return 1
        session = resolve_carrier_session(
            declaration, values, is_emulator, args.dry_run, workspace.session_cache
        )
        return verify.verify_flow(declaration, values, is_emulator, args.dry_run, session)

    errors = validate(declaration, values, is_emulator)
    for error in errors:
        print(error)
    if errors:
        return 1

    session = resolve_carrier_session(
        declaration, values, is_emulator, args.dry_run, workspace.session_cache
    )
    return terraform_verb_flow(declaration, values, is_emulator, args, session)


def cli_main() -> int:
    """Signal net around the whole verb run: Ctrl+C exits with the conventional
    130 instead of a traceback, and EOF at any prompt reads as a cancellation."""
    try:
        return main()
    except KeyboardInterrupt:
        print()
        print("interrupted: rerun the same verb when ready; terraform writes are atomic per run")
        return 130
    except EOFError:
        print()
        print("cancelled: no input received")
        return 1
