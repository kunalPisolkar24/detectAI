"""The plan/apply/destroy verb flow: summary, bucket healing, and the terraform run."""

from __future__ import annotations

import argparse

from app.carrier.identity import plane_account
from app.carrier.role import drop_seeder_flow
from app.carrier.session import session_remaining_text
from app.declaration.model import Declaration, state_bucket_for
from app.shell import run_aws, run_terraform
from app.stack.inputs import (
    PLANE_ROOT,
    build_backend_hcl,
    build_tf_vars,
    state_key,
    write_backend_hcl,
)
from app.stack.state import (
    confirm_purge,
    ensure_state_bucket,
    force_delete_command,
    purge_state,
)
from app.values.plane import (
    plane_display,
    plane_notes,
    resolve_floci_url,
    resolve_recovery_window,
)


def terraform_verb_flow(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    args: argparse.Namespace,
    session: dict[str, str] | None,
) -> int:
    plane = plane_display(is_emulator)
    account = plane_account(session, is_emulator)
    tf_vars = build_tf_vars(declaration, values, is_emulator)
    backend_hcl = build_backend_hcl(declaration, values, is_emulator, account)
    state_bucket = state_bucket_for(declaration.slug, account)
    state_key_value = state_key(declaration, is_emulator)

    blob = {key: values[key] for key in declaration.blob_keys if values.get(key, "") != ""}
    keys_desc = (
        " ".join(f"{key} *** ({len(value)} chars, hidden)" for key, value in blob.items())
        or "(none set)"
    )

    print(f"plane:   {plane}")
    if args.dry_run:
        print("carrier: role session (promoted when the command runs)")
    else:
        print(
            f"carrier: role session ({declaration.seeder_role_name}, valid {session_remaining_text(session)})"
        )
    print(f"stack:   {PLANE_ROOT}")
    print(f"secret: {declaration.secret_name}")
    print(f"keys:    {keys_desc}")
    print(f"state:  {state_bucket} / {state_key_value}")
    print(f"window: {resolve_recovery_window(declaration, values, is_emulator)} day(s)")
    config_keys = [key for key in declaration.ssm_keys if values.get(key, "") != ""]
    if config_keys:
        print(f"config: {len(config_keys)} key(s) -> SSM {declaration.ssm_prefix}")
    for note in plane_notes(declaration, values, is_emulator):
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
        print("(dry run: no terraform, no AWS writes)")
        return 0

    if (
        command == "destroy"
        and args.purge_state
        and not confirm_purge(declaration, values, is_emulator, account, session)
    ):
        return 1

    if ensure_state_bucket(declaration, values, is_emulator, account, session) != 0:
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
        # Terraform runs on the carrier session triplet; env creds outrank any
        # named profile downstream.
        backend_creds = {
            "AWS_ACCESS_KEY_ID": session["access_key_id"],
            "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
            "AWS_SESSION_TOKEN": session["session_token"],
        }

        if run_terraform(PLANE_ROOT, init_args, tf_vars, backend_creds) != 0:
            print()
            if is_emulator:
                print("fix: start floci and rerun; the state bucket recreates itself")
                print(
                    f"fix: check the emulator is reachable at {resolve_floci_url()} "
                    "(e.g. docker start floci)"
                )
            else:
                print(
                    f"fix: check backend access to bucket {state_bucket} "
                    f"in region {declaration.region_default}"
                )
            return 1
        destroyed = run_terraform(PLANE_ROOT, verb_args, tf_vars, backend_creds)
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
        if (
            args.purge_state
            and purge_state(declaration, values, is_emulator, account, session) != 0
        ):
            return 1
        if args.drop_seeder:
            return drop_seeder_flow(declaration, values, is_emulator, args.dry_run)
        return 0
    finally:
        backend_file.unlink(missing_ok=True)
