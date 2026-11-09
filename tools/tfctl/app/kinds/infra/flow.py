"""The infra verbs: plan/apply/auto-apply/destroy flows on the engine's pieces."""

from __future__ import annotations

import argparse
import json
import urllib.request

from app.engine.carrier.identity import plane_account
from app.engine.carrier.role import drop_seeder_flow
from app.engine.carrier.session import session_remaining_text
from app.engine.shell import die, run_terraform
from app.engine.stack.inputs import build_backend_hcl, state_key, write_backend_hcl
from app.engine.stack.state import ensure_state_bucket, preview_purge, purge_state
from app.engine.values.plane import plane_display, resolve_floci_url, resolve_region
from app.kinds.infra.declaration import InfraDeclaration
from app.kinds.infra.tfvars import build_tf_vars
from app.kinds.infra.values import (
    BUCKET_MISSING_ERROR,
    BUCKET_MISSING_FIX,
    DEFAULT_STATE_BUCKET,
    resolve_state_bucket,
    warn_shell_conflicts,
)


def probe_emulator(endpoint: str) -> None:
    """2s health gate: a dead emulator fails loudly here with a start hint
    instead of inside terraform's init (the failure that wastes a run)."""
    try:
        with urllib.request.urlopen(f"{endpoint}/_localstack/health", timeout=2) as response:
            json.load(response)
    except Exception:
        die(
            f"the emulator at {endpoint} did not answer /_localstack/health within 2s",
            "start it (`make floci-up` in the repo root) and rerun",
        )


def _init_failure_hints(
    is_emulator: bool, declaration: InfraDeclaration, values: dict[str, str], bucket: str
) -> None:
    print()
    if is_emulator:
        print("fix: confirm the emulator is up and rerun (the bucket is created on demand)")
        print(
            f"fix: aws --endpoint-url {resolve_floci_url()} "
            f"s3 mb s3://{bucket} --region {resolve_region(declaration, values)}"
        )
    else:
        print(
            f"fix: confirm bucket {bucket} exists and your credentials allow access "
            f"(region {resolve_region(declaration, values)}); plan/apply create it on demand"
        )


def stack_verb_flow(
    declaration: InfraDeclaration,
    values: dict[str, str],
    is_emulator: bool,
    command: str,
    args: argparse.Namespace,
    session,
) -> int:
    """plan/apply: the banner, the self-healed bucket, init -reconfigure, then the verb."""
    bucket = resolve_state_bucket(values, is_emulator)
    if bucket is None:
        die(BUCKET_MISSING_ERROR, BUCKET_MISSING_FIX)
    account = plane_account(session, is_emulator)
    tf_vars = build_tf_vars(declaration, values, is_emulator)
    state_key_value = state_key(declaration, is_emulator)
    warn_shell_conflicts(values)

    print(f"plane:   {plane_display(is_emulator)}")
    if args.dry_run:
        print("carrier: role session (promoted when the command runs)")
    elif session is not None:
        print(
            f"carrier: role session ({declaration.seeder_role_name}, "
            f"valid {session_remaining_text(session)})"
        )
    else:
        print("carrier: ambient credentials")
    print(f"stack:   {declaration.stack_root}")
    print(f"queues:  {len(declaration.queue_ledger)} declared")
    print(f"state:  {bucket} / {state_key_value}")
    if is_emulator and not values.get("TF_STATE_BUCKET"):
        print(f"note:   TF_STATE_BUCKET unset; the Floci plane defaults to {DEFAULT_STATE_BUCKET}")

    if args.dry_run:
        backend_hcl = build_backend_hcl(declaration, values, is_emulator, account, bucket)
        print("backend overrides (written to a temp .hcl at run time):")
        for line in backend_hcl.splitlines():
            print(f"  {line}")
        print(
            f"commands: terraform init -reconfigure -backend-config <backend.hcl>, "
            f"then terraform {command}"
        )
        if command == "destroy":
            if args.force_delete:
                print("then skip: --force-delete is secrets-only (nothing to delete here)")
            if args.purge_state:
                print(f"then purge: every object version in {bucket}, then delete the bucket")
            if args.drop_seeder:
                print(f"then drop: {declaration.seeder_role_name} inline policy and role")
        print("(dry run: no terraform, no AWS writes)")
        return 0

    if command == "destroy" and args.purge_state:
        preview_purge(declaration, values, is_emulator, account, session, bucket)

    if is_emulator:
        probe_emulator(resolve_floci_url())
    if ensure_state_bucket(declaration, values, is_emulator, account, session, bucket) != 0:
        return 1

    backend_file = write_backend_hcl(
        build_backend_hcl(declaration, values, is_emulator, account, bucket)
    )
    try:
        init_args = ["init", "-reconfigure", "-backend-config", str(backend_file)]
        # -input=false kills every prompt; real-AWS apply keeps its approval
        # prompt, while destroy auto-approves on both planes.
        verb_args = [command]
        if command == "plan" or is_emulator or command == "destroy":
            verb_args.append("-input=false")
        if command == "destroy" or (command == "apply" and is_emulator):
            verb_args.append("-auto-approve")
        # Terraform runs on the carrier session triplet; env creds outrank any
        # named profile downstream.
        backend_creds = {
            "AWS_ACCESS_KEY_ID": session["access_key_id"],
            "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
            "AWS_SESSION_TOKEN": session["session_token"],
        }

        if run_terraform(declaration.stack_root, init_args, tf_vars, backend_creds) != 0:
            _init_failure_hints(is_emulator, declaration, values, bucket)
            return 1
        destroyed = run_terraform(declaration.stack_root, verb_args, tf_vars, backend_creds)
        if command != "destroy" or destroyed != 0:
            return destroyed
        if args.force_delete:
            print(
                "note: --force-delete is secrets-only (it skips a Secrets Manager "
                "recovery window); nothing to delete here"
            )
        # Wipe chain runs only after terraform succeeded: purge, then the seeder role.
        if (
            args.purge_state
            and purge_state(declaration, values, is_emulator, account, session, bucket) != 0
        ):
            return 1
        if args.drop_seeder:
            return drop_seeder_flow(declaration, values, is_emulator, args.dry_run)
        return 0
    finally:
        backend_file.unlink(missing_ok=True)
