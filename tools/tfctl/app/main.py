"""Verb entry point: argument parsing, kind resolution, and verb dispatch.

main.py is the composition root by being the caller: every kind registers its
slot here, and each verb's mechanics live in its own subpackage. The registry
is what makes the engine stack-agnostic: which declaration file a directory
holds decides which Kind drives the run, while the engine's verbs behave the
same against either."""

from __future__ import annotations

import argparse
import io
import sys
from dataclasses import replace
from pathlib import Path

from app.engine.carrier.role import drop_seeder_flow
from app.engine.carrier.session import (
    clear_cached_session,
    clear_cached_session_files,
    resolve_carrier_session,
    session_cache_for,
)
from app.engine.declaration.model import DeclarationError
from app.engine.shell import die
from app.engine.values.parse import parse_env_file
from app.engine.values.rules import plane_errors
from app.kinds import KINDS, register
from app.kinds.locate import (
    REPO_ROOT,
    find_service_workspace,
    ready_service_workspaces,
    stack_dir_workspace,
)
from app.kinds.observability import kind as observability_kind
from app.kinds.secrets import kind as secrets_kind
from app.kinds.secrets.batch import refresh_all_flow

register(secrets_kind())
register(observability_kind())

VERBS = tuple(dict.fromkeys(verb for kind in KINDS.values() for verb in kind.my_verbs))


def _print_errors(errors: list[str]) -> bool:
    for error in errors:
        print(error)
    return bool(errors)


def _verify_flow(kind, declaration, values: dict[str, str], is_emulator: bool, dry_run: bool, session) -> int:
    if kind.verify is None:
        die(
            f"the {kind.name} kind declares the verify verb but supplies no verify flow",
            "wire the kind's verify flow in its app/kinds/<kind>/__init__.py, or drop the verb",
        )
    return kind.verify(declaration, values, is_emulator, dry_run, session)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tfctl",
        description="Validate a stack's values file and drive its terraform verbs, kind by kind.",
    )
    parser.add_argument(
        "command",
        choices=VERBS,
        help="terraform plan/apply/destroy, verify, and auto-apply (plan, apply, then the "
        "kind's live audit when it supplies one, aborting at the first failure), with the "
        "state bucket and seeder role "
        "created on demand on both planes; seeder-drop detaches and deletes the "
        "seeder role; session-clear drops the targeted service's cached seeder "
        "session and session-clear-all drops every cached one; session-refresh-all "
        "mints every ready service's seeder session in one run (one shared MFA code "
        "on real AWS); check drives the observability stack's credential "
        "round-trip (envs/.env)",
    )
    parser.add_argument(
        "--service",
        help="service name under <repo root>/services (default: nearest secrets.toml upward)",
    )
    parser.add_argument(
        "--stack-dir",
        help="explicit stack directory that holds a declaration file "
        "(e.g. observability; skips the service/cwd discovery)",
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
    if args.service and args.stack_dir:
        die(
            "--service and --stack-dir name two different stacks; pass only one",
            "point --stack-dir at a directory holding a declaration file, or use --service",
        )
    if args.stack_dir and args.command in ("session-clear-all", "session-refresh-all"):
        die(
            f"--stack-dir does not apply to the {args.command} command (it runs across every service)",
            "run a single-service verb without --stack-dir",
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
        if args.stack_dir:
            stack_dir = Path(args.stack_dir)
            if not stack_dir.is_absolute():
                # Stack dirs name repo locations; poetry -C and friends shift
                # the cwd, so a relative name anchors where --service does.
                stack_dir = REPO_ROOT / stack_dir
            workspace = stack_dir_workspace(stack_dir)
        else:
            workspace = find_service_workspace(REPO_ROOT, args.service)
    if args.values_file:
        workspace = replace(workspace, values_file=Path(args.values_file))
    kind = workspace.kind
    try:
        declaration = kind.load(workspace.declaration_file)
    except DeclarationError as exc:
        fix = "fix the service's secrets.toml"
        if args.command == "session-clear":
            fix = "run session-clear-all to drop every cached seeder session, or fix the service's secrets.toml"
        die(str(exc), fix)

    if args.command not in kind.my_verbs:
        die(
            f"{args.command} is not a verb of the {kind.name} kind",
            "see the kind's verbs in the tool's README",
        )

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
            kind.values_hint,
        )
    values = parse_env_file(workspace.values_file)
    is_emulator = kind.resolve_plane(values, args.aws, args.floci)

    if args.command == "seeder-drop":
        if _print_errors(plane_errors(values)):
            return 1
        return drop_seeder_flow(declaration, values, is_emulator, args.dry_run)

    if args.command == "verify":
        if _print_errors(plane_errors(values)):
            return 1
        session = resolve_carrier_session(
            declaration,
            values,
            is_emulator,
            args.dry_run,
            session_cache_for(declaration),
            kind.seeder_policy,
        )
        return _verify_flow(kind, declaration, values, is_emulator, args.dry_run, session)

    if _print_errors(kind.validate(declaration, values, is_emulator)):
        return 1

    session = None
    if args.command in kind.carried_verbs:
        session = resolve_carrier_session(
            declaration,
            values,
            is_emulator,
            args.dry_run,
            session_cache_for(declaration),
            kind.seeder_policy,
        )

    if args.command == "auto-apply":
        if args.dry_run:
            kind.terraform_flow(declaration, values, is_emulator, "plan", args, session)
            print(
                "then apply:  terraform apply with the same backend overrides (auto on the "
                "emulator, interactive confirm on real AWS)"
            )
            if kind.verify is not None:
                print(
                    "then verify: the live SSM parameters and secret blob vs the values file "
                    "(exit 1 on drift)"
                )
            return 0
        for step in ("plan", "apply"):
            code = kind.terraform_flow(declaration, values, is_emulator, step, args, session)
            if code != 0:
                return code
        if kind.verify is None:
            return 0
        return _verify_flow(kind, declaration, values, is_emulator, False, session)

    if args.command in ("plan", "apply", "destroy"):
        return kind.terraform_flow(declaration, values, is_emulator, args.command, args, session)
    if kind.verb_flow is not None:
        return kind.verb_flow(declaration, values, is_emulator, args.command, args, session)
    die(
        f"{args.command} is not a single-service verb for the {kind.name} kind",
        "see the kind's verbs in the tool's README",
    )


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
