"""Verb entry point: argument parsing, service resolution, and the plan/apply/destroy flow."""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

from secretsctl import config, verify
from secretsctl.config import Declaration, DeclarationError, Workspace
from secretsctl.env import (
    parse_env_file,
    plane_errors,
    plane_notes,
    resolve_plane,
    resolve_recovery_window,
    resolve_state_bucket,
    validate,
    validate_bootstrap,
    warn_shell_conflicts,
)
from secretsctl.proc import die, run_aws, run_terraform
from secretsctl.seeder import (
    clear_cached_session,
    drop_seeder_flow,
    resolve_carrier_session,
    seeder_bootstrap_flow,
    session_remaining_text,
    validate_seeder_bootstrap,
    validate_seeder_role,
)
from secretsctl.stack import (
    bootstrap_state,
    build_backend_hcl,
    build_tf_vars,
    confirm_purge,
    ensure_state_bucket,
    force_delete_command,
    purge_state,
    state_key,
    write_backend_hcl,
)

VERBS = (
    "plan",
    "apply",
    "verify",
    "bootstrap",
    "destroy",
    "seeder-bootstrap",
    "seeder-drop",
    "session-clear",
)

REPO_ROOT = Path(__file__).resolve().parents[4]


def find_service_workspace(repo_root: Path, service: str | None) -> Workspace:
    if service is not None:
        service_dir = repo_root / "services" / service
        if not (service_dir / "secrets.toml").exists():
            die(
                f"no secrets.toml found in {service_dir}",
                "add one to the service root (see the secretsctl README)",
            )
        return config.workspace_for(service_dir)
    for candidate in (Path.cwd(), *Path.cwd().parents):
        if (candidate / "secrets.toml").exists():
            return config.workspace_for(candidate)
    die(
        "no secrets.toml found from the current directory upward",
        "run the tool inside a service directory or pass --service <name>",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="secretsctl",
        description="Validate a service's .env against its secrets.toml and drive the secrets stack.",
    )
    parser.add_argument(
        "command",
        choices=VERBS,
        help="terraform plan/apply/destroy, bootstrap (create the plane's state bucket via the aws CLI), "
        "verify (read the live plane and match it against the .env values, fingerprints only), "
        "seeder-bootstrap (create/update the out-of-stack seeder role), seeder-drop (detach and "
        "delete it), or session-clear (drop the cached seeder session file)",
    )
    parser.add_argument(
        "--service",
        help="service name under <repo root>/services (default: nearest secrets.toml upward)",
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


def _terraform_verb_flow(
    declaration: Declaration,
    workspace: Workspace,
    values: dict[str, str],
    is_emulator: bool,
    args: argparse.Namespace,
    session: dict[str, str] | None,
) -> int:
    plane, _ = resolve_plane(values)
    tf_vars = build_tf_vars(declaration, values)
    backend_hcl = build_backend_hcl(declaration, values, is_emulator)
    warn_shell_conflicts(values)
    state_bucket = resolve_state_bucket(declaration, values, is_emulator)
    assert state_bucket is not None  # validation already rejected a missing bucket
    state_key_value = state_key(declaration, is_emulator)

    blob = {key: values[key] for key in declaration.blob_keys if values.get(key, "") != ""}
    keys_desc = (
        " ".join(f"{key} *** ({len(value)} chars, hidden)" for key, value in blob.items())
        or "(none set)"
    )

    print(f"plane:   {plane}")
    if is_emulator:
        print("carrier: env creds (test/test, profile stripped)")
    elif args.dry_run:
        print("carrier: seeder role session (promoted when the command runs)")
    else:
        print(
            f"carrier: role session ({declaration.seeder_role_name}, valid {session_remaining_text(session)})"
        )
    print(f"stack:   {config.PLANE_ROOT}")
    print(f"secret: {declaration.secret_name}")
    print(f"keys:    {keys_desc}")
    print(f"state:  {state_bucket} / {state_key_value}")
    print(f"window: {resolve_recovery_window(declaration, values, is_emulator)} day(s)")
    config_keys = [key for key in declaration.ssm_keys if values.get(key, "") != ""]
    if config_keys:
        print(f"config: {len(config_keys)} key(s) -> SSM {declaration.ssm_prefix}")
    for note in plane_notes(declaration, values, plane):
        print(note)

    command = args.command
    if args.dry_run:
        print("backend overrides (written to a temp .hcl at run time):")
        for line in backend_hcl.splitlines():
            print(f"  {line}")
        print(
            f"commands: terraform init -reconfigure -backend-config <backend.hcl>, then terraform {command}"
        )
        if command == "destroy":
            if args.force_delete:
                if is_emulator:
                    print(
                        "then skip: --force-delete has no effect on the emulator (0-day recovery window)"
                    )
                else:
                    print(
                        f"then run: {' '.join(force_delete_command(declaration, values, is_emulator))}"
                    )
            if args.purge_state:
                print(f"then purge: every object version in {state_bucket}, then delete the bucket")
            if args.drop_seeder:
                print(f"then drop: {declaration.seeder_role_name} inline policy and role")
        print("(dry run: no terraform, no AWS)")
        return 0

    if (
        command == "destroy"
        and args.purge_state
        and not confirm_purge(declaration, values, is_emulator, session)
    ):
        return 1

    if ensure_state_bucket(declaration, values, is_emulator) != 0:
        return 1

    backend_file = write_backend_hcl(backend_hcl)
    try:
        init_args = ["init", "-reconfigure", "-backend-config", str(backend_file)]
        # -input=false kills every prompt incl. apply approval; real AWS keeps its confirm.
        verb_args = [command]
        if command == "plan" or is_emulator:
            verb_args.append("-input=false")
        if command in ("apply", "destroy") and is_emulator:
            verb_args.append("-auto-approve")
        # Terraform runs on the carrier's creds: emulator fakes, or the seeder
        # session triplet (env creds outrank any named profile downstream).
        backend_creds = (
            {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
            if is_emulator
            else {
                "AWS_ACCESS_KEY_ID": session["access_key_id"],
                "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
                "AWS_SESSION_TOKEN": session["session_token"],
            }
        )

        if run_terraform(config.PLANE_ROOT, init_args, tf_vars, backend_creds) != 0:
            print()
            if is_emulator:
                print("fix: create the emulator state bucket and retry (the bootstrap verb)")
                print(
                    f"fix: aws --endpoint-url {values['EMULATOR_ENDPOINT']} "
                    f"s3 mb s3://{resolve_state_bucket(declaration, values, True)} "
                    f"--region {declaration.region_default}"
                )
            else:
                print(
                    f"fix: confirm bucket {state_bucket} exists and your credentials allow access "
                    f"(region {declaration.region_default}); the bootstrap verb can create it"
                )
            return 1
        destroyed = run_terraform(config.PLANE_ROOT, verb_args, tf_vars, backend_creds)
        if command != "destroy" or destroyed != 0:
            return destroyed
        if args.force_delete:
            if is_emulator:
                print("note: --force-delete has no effect on the emulator (0-day recovery window)")
            else:
                run_aws(
                    force_delete_command(declaration, values, is_emulator), is_emulator, session
                )
        # Wipe chain runs only after terraform succeeded: purge, then the seeder role.
        if args.purge_state and purge_state(declaration, values, is_emulator, session) != 0:
            return 1
        if args.drop_seeder:
            return drop_seeder_flow(declaration, values, is_emulator, args.dry_run)
        return 0
    finally:
        backend_file.unlink(missing_ok=True)


def main(argv: list[str] | None = None, workspace: Workspace | None = None) -> int:
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
        workspace = config.workspace_for(workspace.service_dir, Path(args.values_file))

    if args.command == "session-clear":
        if clear_cached_session(workspace.session_cache):
            print(f"removed: {workspace.session_cache}")
        else:
            print("nothing to clear (no cached seeder session)")
        return 0

    try:
        declaration = config.load(workspace.service_dir / "secrets.toml")
    except DeclarationError as exc:
        die(str(exc), "fix the service's secrets.toml")
    if not workspace.values_file.exists():
        die(
            f"{workspace.values_file} not found",
            "create the service's infra/.env first (copy its committed .env.example)",
        )
    values = parse_env_file(workspace.values_file)
    plane, is_emulator = resolve_plane(values)

    if args.command == "bootstrap":
        errors = validate_bootstrap(declaration, values, is_emulator)
        for error in errors:
            print(error)
        if errors:
            return 1
        session = resolve_carrier_session(
            declaration, values, is_emulator, args.dry_run, workspace.session_cache
        )
        return bootstrap_state(declaration, values, is_emulator, args.dry_run, session)

    if args.command == "seeder-bootstrap":
        errors = validate_seeder_bootstrap(declaration, values, is_emulator)
        for error in errors:
            print(error)
        if errors:
            return 1
        return seeder_bootstrap_flow(declaration, values, is_emulator, args.dry_run)

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
    return _terraform_verb_flow(declaration, workspace, values, is_emulator, args, session)


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
