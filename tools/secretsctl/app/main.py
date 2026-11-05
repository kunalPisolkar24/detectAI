"""Verb entry point: argument parsing, service resolution, and verb dispatch.

main.py is the composition root by being the caller: every flow gets wired
here, while each verb's mechanics live in its own subpackage.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from app.carrier.role import drop_seeder_flow
from app.carrier.session import (
    clear_cached_session,
    clear_cached_session_files,
    refresh_all_flow,
    resolve_carrier_session,
    session_cache_for,
)
from app.declaration.loader import DeclarationError, load
from app.declaration.locate import (
    REPO_ROOT,
    find_service_workspace,
    ready_service_workspaces,
    workspace_for,
)
from app.shell import die
from app.stack.flow import terraform_verb_flow
from app.verify import flow as verify
from app.values.parse import parse_env_file
from app.values.plane import emulator_endpoint_note
from app.values.rules import plane_errors, validate

VERBS = (
    "plan",
    "apply",
    "verify",
    "auto-apply",
    "destroy",
    "seeder-drop",
    "session-clear",
    "session-clear-all",
    "session-refresh-all",
)


def _print_errors(errors: list[str]) -> bool:
    for error in errors:
        print(error)
    return bool(errors)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="secretsctl",
        description="Validate a service's .env against its secrets.toml and drive the secrets stack.",
    )
    parser.add_argument(
        "command",
        choices=VERBS,
        help="terraform plan/apply/destroy, verify, and auto-apply (the whole seed: "
        "the values check, terraform plan, apply, then verify of the live plane, "
        "aborting at the first failure), with the state bucket and seeder role "
        "created on demand on both planes; seeder-drop detaches and deletes the "
        "seeder role; session-clear drops the targeted service's cached seeder "
        "session and session-clear-all drops every cached one; session-refresh-all "
        "mints every ready service's seeder session in one run (one shared MFA code on real AWS)",
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
        "--force",
        action="store_true",
        help="session-refresh-all only: re-mint every ready service's seeder session "
        "even when a cached one is still valid",
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
    if args.force and args.command != "session-refresh-all":
        die(
            "--force only applies to the session-refresh-all command",
            "run it with session-refresh-all",
        )
    if args.service and args.command in ("session-clear-all", "session-refresh-all"):
        die(
            f"--service does not apply to the {args.command} command (it runs across every service)",
            "run a single-service verb without --service",
        )
    if args.values_file and args.command in ("session-clear-all", "session-refresh-all"):
        die(
            f"--values-file does not apply to the {args.command} command (each service rides its own infra/.env)",
            "run a single-service verb without --values-file",
        )

    if args.command == "session-clear-all":
        removed = clear_cached_session_files()
        for path in removed:
            print(f"removed: {path}")
        if not removed:
            print("nothing to clear (no cached seeder sessions)")
        return 0

    if args.command == "session-refresh-all":
        return refresh_all_flow(
            ready_service_workspaces(REPO_ROOT),
            not args.aws,
            args.force,
            args.dry_run,
        )

    if workspace is None:
        workspace = find_service_workspace(REPO_ROOT, args.service)
    if args.values_file:
        workspace = workspace_for(workspace.service_dir, Path(args.values_file))

    try:
        declaration = load(workspace.service_dir / "secrets.toml")
    except DeclarationError as exc:
        fix = "fix the service's secrets.toml"
        if args.command == "session-clear":
            fix = "run session-clear-all to drop every cached seeder session, or fix the service's secrets.toml"
        die(str(exc), fix)

    if args.command == "session-clear":
        cache = session_cache_for(declaration)
        if clear_cached_session(cache):
            print(f"removed: {cache}")
        else:
            print(f"nothing to clear (no cached seeder session for {declaration.slug})")
        return 0

    if not workspace.values_file.exists():
        die(
            f"{workspace.values_file} not found",
            "create the service's infra/.env first (copy its committed .env.example)",
        )
    values = parse_env_file(workspace.values_file)
    if (note := emulator_endpoint_note(values)) is not None:
        print(note)
    is_emulator = not args.aws

    if args.command == "seeder-drop":
        if _print_errors(plane_errors(values)):
            return 1
        return drop_seeder_flow(declaration, values, is_emulator, args.dry_run)

    if args.command == "verify":
        if _print_errors(plane_errors(values)):
            return 1
        session = resolve_carrier_session(
            declaration, values, is_emulator, args.dry_run, session_cache_for(declaration)
        )
        return verify.verify_flow(declaration, values, is_emulator, args.dry_run, session)

    if _print_errors(validate(declaration, values, is_emulator)):
        return 1

    session = resolve_carrier_session(
        declaration, values, is_emulator, args.dry_run, session_cache_for(declaration)
    )

    if args.command == "auto-apply":
        if args.dry_run:
            terraform_verb_flow(declaration, values, is_emulator, "plan", args, session)
            print(
                "then apply:  terraform apply with the same backend overrides (auto on the "
                "emulator, interactive confirm on real AWS)"
            )
            print(
                "then verify: the live SSM parameters and secret blob vs the values file (exit 1 on drift)"
            )
            return 0
        for step in ("plan", "apply"):
            code = terraform_verb_flow(declaration, values, is_emulator, step, args, session)
            if code != 0:
                return code
        return verify.verify_flow(declaration, values, is_emulator, False, session)

    return terraform_verb_flow(declaration, values, is_emulator, args.command, args, session)


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
