"""Terraform inputs and the stack verbs: plan/apply/destroy, bucket healing and state purge."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from secretsctl.config import Declaration, state_bucket_for
from secretsctl.env import (
    resolve_floci_url,
    resolve_recovery_window,
    resolve_region,
)
from secretsctl.proc import aws_base, run_aws, run_aws_captured


def state_key(declaration: Declaration, is_emulator: bool) -> str:
    segment = "floci/" if is_emulator else ""
    return f"{declaration.slug}/{segment}terraform.tfstate"


def build_tf_vars(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> dict[str, str]:
    tf_vars = {
        "TF_VAR_aws_region": resolve_region(declaration, values),
        "TF_VAR_service_slug": declaration.slug,
        "TF_VAR_secret_recovery_window": str(
            resolve_recovery_window(declaration, values, is_emulator)
        ),
    }
    # Non-empty blob keys ride the secrets blob: the whole map is the contract.
    blob = {key: values[key] for key in declaration.blob_keys if values.get(key, "") != ""}
    if blob:
        tf_vars["TF_VAR_blob"] = json.dumps(blob)
    # Non-secret config rides the SSM map; absent or empty seeds nothing.
    config = {key: values[key] for key in declaration.ssm_keys if values.get(key, "") != ""}
    if config:
        tf_vars["TF_VAR_ssm_parameters"] = json.dumps(config)
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = resolve_floci_url()
    return tf_vars


def build_backend_hcl(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, account: str
) -> str:
    region = resolve_region(declaration, values)
    bucket = state_bucket_for(declaration.slug, account)
    key = state_key(declaration, is_emulator)
    if is_emulator:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{key}"',
            f'region                      = "{region}"',
            "encrypt                     = false",
            "skip_credentials_validation = true",
            "skip_metadata_api_check     = true",
            "skip_requesting_account_id  = true",
            "skip_region_validation      = true",
            "use_path_style              = true",
            "endpoints = {",
            f'  s3 = "{resolve_floci_url()}"',
            "}",
        ]
    else:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{key}"',
            f'region                      = "{region}"',
            "encrypt                     = true",
            "use_lockfile                = true",
        ]
    return "\n".join(lines) + "\n"


def write_backend_hcl(backend_hcl: str) -> Path:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".hcl", delete=False) as handle:
        handle.write(backend_hcl)
        return Path(handle.name)


def ensure_state_bucket(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    account: str,
    session: dict[str, str] | None = None,
) -> int:
    """Create-on-demand: terraform owns nothing about the state bucket, so any
    acting verb may find it missing (the emulator loses S3 data on restart; a
    fresh real plane starts empty) and heal it under the carrier session."""
    base = aws_base(declaration, values, is_emulator)
    bucket = state_bucket_for(declaration.slug, account)
    # The head rides captured streams: an existing bucket stays silent, and a
    # missing one reports through the note instead of a raw SDK error.
    head = run_aws_captured(
        base + ["s3api", "head-bucket", "--bucket", bucket], is_emulator, session
    )
    if head[0] == 0:
        return 0

    print(f"note: state bucket {bucket} is missing; creating it")
    if run_aws(base + ["s3", "mb", f"s3://{bucket}"], is_emulator, session) != 0:
        if is_emulator:
            print()
            print(
                f"fix: check that the emulator is reachable at {resolve_floci_url()} (e.g. docker start floci)"
            )
        return 1
    print(f"created: {bucket}")
    if (
        run_aws(
            base
            + [
                "s3api",
                "put-bucket-versioning",
                "--bucket",
                bucket,
                "--versioning-configuration",
                "Status=Enabled",
            ],
            is_emulator,
            session,
        )
        != 0
    ):
        print("fix: enable bucket versioning manually (required for terraform state safety)")
        return 1
    print("versioning: Enabled")
    return 0


def force_delete_command(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    return aws_base(declaration, values, is_emulator) + [
        "secretsmanager",
        "delete-secret",
        "--secret-id",
        declaration.secret_name,
        "--force-delete-without-recovery",
    ]


def list_bucket_versions(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    account: str,
    session: dict[str, str] | None = None,
) -> list[tuple[str, str]] | None:
    """Every (key, version id) in the plane's state bucket, None when listing failed;
    the CLI paginates, so one call spans the bucket."""
    bucket = state_bucket_for(declaration.slug, account)
    code, stdout, stderr = run_aws_captured(
        aws_base(declaration, values, is_emulator)
        + ["s3api", "list-object-versions", "--bucket", bucket, "--output", "json"],
        is_emulator,
        session,
    )
    if code != 0:
        print(f"error: could not list object versions in {bucket}")
        if stderr.strip():
            print(stderr.strip())
        return None
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        print(f"error: list-object-versions returned unparseable output: {exc}")
        return None
    items = []
    for kind in ("Versions", "DeleteMarkers"):
        for entry in payload.get(kind) or []:
            items.append((entry["Key"], entry["VersionId"]))
    return items


def confirm_purge(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    account: str,
    session: dict[str, str] | None = None,
) -> bool:
    """Typed barrier — terraform does not manage the bucket; a refusal leaves everything intact."""
    bucket = state_bucket_for(declaration.slug, account)
    if (
        run_aws(
            aws_base(declaration, values, is_emulator)
            + ["s3api", "head-bucket", "--bucket", bucket],
            is_emulator,
            session,
        )
        != 0
    ):
        print(f"note: bucket {bucket} does not exist; the purge step will be a no-op")
        return True
    items = list_bucket_versions(declaration, values, is_emulator, account, session) or []
    if items:
        print(f"purge will wipe {len(items)} object version(s) in {bucket}")
        prefixes = sorted({key.split("/", 1)[0] for key, _ in items})
        others = [prefix for prefix in prefixes if prefix != declaration.slug]
        if others:
            print(
                f"warning: {bucket} also holds objects outside {declaration.slug}/ "
                f"(prefixes: {', '.join(others)}); deleting the bucket removes them too"
            )
    if is_emulator:
        print(
            f"note: emulator plane purges {bucket} without a typed confirmation (auto-apply plane)"
        )
        return True
    answer = input(f'type "{bucket}" to wipe it and delete it: ').strip()
    if answer != bucket:
        print("cancelled: nothing was destroyed")
        return False
    return True


def purge_state(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    account: str,
    session: dict[str, str] | None = None,
) -> int:
    """Wipe + delete the state bucket, only after terraform destroy succeeded; rerunnable."""
    bucket = state_bucket_for(declaration.slug, account)
    base = aws_base(declaration, values, is_emulator)
    if run_aws(base + ["s3api", "head-bucket", "--bucket", bucket], is_emulator, session) != 0:
        print(f"note: bucket {bucket} is already gone; nothing to purge")
        return 0
    items = list_bucket_versions(declaration, values, is_emulator, account, session)
    if items is None:
        return 1
    if not items:
        print(f"purge: {bucket} holds no objects")
    for key, version_id in items:
        print(f"purging: {key}")
        delete = base + [
            "s3api",
            "delete-object",
            "--bucket",
            bucket,
            "--key",
            key,
            "--version-id",
            version_id,
        ]
        if run_aws(delete, is_emulator, session) != 0:
            return 1
    if run_aws(base + ["s3api", "delete-bucket", "--bucket", bucket], is_emulator, session) != 0:
        print("fix: rerun the destroy verb — safe to repeat when the deletions are still settling")
        return 1
    print(f"deleted: {bucket}")
    return 0
