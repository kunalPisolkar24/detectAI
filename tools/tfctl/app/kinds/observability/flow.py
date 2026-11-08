"""The observability verbs: check, plan, and apply."""

from __future__ import annotations

import argparse
import json
import os
import urllib.request

from app.engine.carrier.identity import plane_account
from app.engine.carrier.session import session_remaining_text
from app.engine.shell import die, run_terraform
from app.engine.stack.inputs import build_backend_hcl, state_key, write_backend_hcl
from app.engine.stack.state import ensure_state_bucket
from app.engine.values.plane import plane_display, resolve_floci_url, resolve_region
from app.kinds.observability.account import MOCK_ACCOUNT_ID, live_check
from app.kinds.observability.declaration import ObservabilityDeclaration
from app.kinds.observability.tfvars import build_tf_vars
from app.kinds.observability.values import (
    BUCKET_MISSING_ERROR,
    BUCKET_MISSING_FIX,
    DEFAULT_STATE_BUCKET,
    build_config,
    resolve_state_bucket,
    validate_config,
    warn_shell_conflicts,
)


def masked(api_key: str) -> str:
    return f"{api_key[:4]}...{api_key[-4:]}"


def describe_config(config: dict[str, str | None]) -> None:
    region = config["region"] or "EU"
    source = "shell" if os.environ.get("NEW_RELIC_API_KEY") else "envs/.env"
    print("credentials:")
    print(f"  NEW_RELIC_API_KEY     {masked(config['api_key'])} (from {source})")
    print(
        f"  NEW_RELIC_ACCOUNT_ID  {config['account_id'] or MOCK_ACCOUNT_ID} "
        "(mock — set a real account ID)"
    )
    print(f"  NEW_RELIC_REGION      {region}")


def describe_plane(
    declaration: ObservabilityDeclaration, values: dict[str, str], is_emulator: bool
) -> None:
    bucket = resolve_state_bucket(values, is_emulator)
    state_key_value = state_key(declaration, is_emulator)
    print(f"plane:  {plane_display(is_emulator)}")
    if bucket:
        print(f"state:  {bucket} / {state_key_value}")
        if is_emulator and not values.get("TF_STATE_BUCKET"):
            print(
                f"note:   TF_STATE_BUCKET unset; the Floci plane defaults to {DEFAULT_STATE_BUCKET}"
            )
    else:
        print("state:  unset -> TF_STATE_BUCKET is required before plan/apply run")
        print(
            "note:   add TF_STATE_BUCKET to envs/.env, or run with --floci "
            f"(the bucket then defaults to {DEFAULT_STATE_BUCKET})"
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


def check_flow(
    declaration: ObservabilityDeclaration, values: dict[str, str], is_emulator: bool
) -> int:
    """Validate the credential pair against the live account: no state, no terraform."""
    config = build_config(values)
    errors = validate_config(config)
    for error in errors:
        print(error)
    if errors:
        return 1
    describe_config(config)
    describe_plane(declaration, values, is_emulator)
    live_check(config)
    return 0


def _init_failure_hints(
    is_emulator: bool, declaration: ObservabilityDeclaration, values: dict[str, str], bucket: str
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
    declaration: ObservabilityDeclaration,
    values: dict[str, str],
    is_emulator: bool,
    command: str,
    args: argparse.Namespace,
    session,
) -> int:
    """plan/apply: the banner, the self-healed bucket, init -reconfigure, then the verb."""
    config = build_config(values)
    errors = validate_config(config)
    for error in errors:
        print(error)
    if errors:
        return 1
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
    print(f"key:     *** ({len(config['api_key'] or "")} chars, hidden)")
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
        print("(dry run: no terraform, no AWS writes)")
        return 0

    if is_emulator:
        probe_emulator(resolve_floci_url())
    if ensure_state_bucket(declaration, values, is_emulator, account, session, bucket) != 0:
        return 1

    backend_file = write_backend_hcl(
        build_backend_hcl(declaration, values, is_emulator, account, bucket)
    )
    try:
        init_args = ["init", "-reconfigure", "-backend-config", str(backend_file)]
        # -input=false disables ALL prompts, including the apply approval; real
        # AWS must keep its confirm prompt, so it applies without the flag.
        verb_args = [command]
        if command == "plan" or is_emulator:
            verb_args.append("-input=false")
        if command == "apply" and is_emulator:
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
        return run_terraform(declaration.stack_root, verb_args, tf_vars, backend_creds)
    finally:
        backend_file.unlink(missing_ok=True)


def verb_flow(
    declaration: ObservabilityDeclaration,
    values: dict[str, str],
    is_emulator: bool,
    command: str,
    args: argparse.Namespace,
    session,
) -> int:
    """The verb that never touches terraform: check."""
    if command == "check":
        return check_flow(declaration, values, is_emulator)
    raise AssertionError(f"{command} is not an observability-kind verb")
