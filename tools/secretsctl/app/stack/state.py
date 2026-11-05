"""The state bucket lifecycle: create-on-demand, list, purge, and the purge preview."""

from __future__ import annotations

import json

from app.declaration.model import Declaration, state_bucket_for
from app.shell import aws_base, run_aws, run_aws_captured
from app.values.plane import resolve_floci_url


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


def preview_purge(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    account: str,
    session: dict[str, str] | None = None,
) -> None:
    """Prints what the post-destroy purge will wipe; destroy proceeds without a confirmation."""
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
        return
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
