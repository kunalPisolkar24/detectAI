"""Local snapshots of a stack's Terraform state ledger.

The floci emulator forgets S3 on restart, so its state bucket — and the ledger
inside it — can vanish between runs. This module keeps a durable copy on disk
and, on the emulator plane only, restores it automatically before a plan/apply
and refreshes it after a successful apply. Real AWS needs none of this: S3 is
durable and versioned, so snapshots there are explicit opt-in verbs only.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from app.engine.carrier.identity import plane_account
from app.engine.declaration.model import Declaration, state_bucket_for
from app.engine.shell import aws_base, die, run_aws, run_aws_captured
from app.engine.stack.inputs import state_key
from app.engine.stack.state import ensure_state_bucket
from app.engine.values.plane import plane_display

STATE_VERBS = ("state-save", "state-load", "state-status")
KEEP_SNAPSHOTS = 10


def snapshot_root() -> Path:
    override = os.environ.get("TFCTL_STATE_BACKUP_DIR")
    return Path(override).expanduser() if override else Path.home() / ".local" / "share" / "tfctl" / "state"


def snapshot_dir(declaration: Declaration, is_emulator: bool) -> Path:
    return snapshot_root() / declaration.slug / ("floci" if is_emulator else "aws")


def default_snapshot(declaration: Declaration, is_emulator: bool) -> Path:
    return snapshot_dir(declaration, is_emulator) / "latest.tfstate"


def meta_path(path: Path) -> Path:
    return path.with_suffix(".meta.json")


def _write_meta(path: Path, declaration: Declaration, is_emulator: bool, serial: int) -> None:
    meta_path(path).write_text(
        json.dumps(
            {
                "slug": declaration.slug,
                "plane": "floci" if is_emulator else "aws",
                "serial": serial,
                "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            indent=2,
        )
        + "\n"
    )
    os.chmod(meta_path(path), 0o600)


def _validate(path: Path, declaration: Declaration, is_emulator: bool) -> dict:
    if not path.is_file():
        die(f"state snapshot {path} does not exist", "run `tfctl state-save` first")
    try:
        state = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        die(f"state snapshot {path} is not valid JSON: {exc}", "choose a different --file")
    if not isinstance(state.get("resources"), list) or "version" not in state:
        die(f"state snapshot {path} is not a Terraform state file", "choose a different --file")
    meta_file = meta_path(path)
    if meta_file.is_file():
        try:
            meta = json.loads(meta_file.read_text())
        except (OSError, json.JSONDecodeError):
            meta = {}
        if meta.get("slug") not in (None, declaration.slug):
            die(
                f"snapshot {path} belongs to stack {meta['slug']!r}, not {declaration.slug!r}",
                "pass a snapshot from the same stack",
            )
        if meta.get("plane") not in (None, "floci" if is_emulator else "aws"):
            die(
                f"snapshot {path} belongs to a different plane",
                "pass a snapshot from the same plane",
            )
    return state


def _ledger_exists(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
) -> bool:
    head = run_aws_captured(
        aws_base(declaration, values, is_emulator) + ["s3api", "head-object", "--bucket", bucket, "--key", key],
        is_emulator,
        session,
    )
    return head[0] == 0


def _pull(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
    target: Path,
) -> bool:
    return (
        run_aws(
            aws_base(declaration, values, is_emulator)
            + ["s3api", "get-object", "--bucket", bucket, "--key", key, str(target)],
            is_emulator,
            session,
        )
        == 0
    )


def _push(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
    source: Path,
) -> bool:
    return (
        run_aws(
            aws_base(declaration, values, is_emulator)
            + ["s3api", "put-object", "--bucket", bucket, "--key", key, "--body", str(source)],
            is_emulator,
            session,
        )
        == 0
    )


def save_snapshot(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
    dry_run: bool = False,
) -> int:
    """Pull the live ledger into a timestamped local snapshot plus `latest`."""
    if dry_run:
        print(f"would save: {bucket} / {key} -> {default_snapshot(declaration, is_emulator)}")
        return 0
    if not _ledger_exists(declaration, values, is_emulator, bucket, key, session):
        print(f"note: no state ledger at {bucket} / {key}; nothing to save")
        return 0
    folder = snapshot_dir(declaration, is_emulator)
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    target = folder / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.tfstate"
    if not _pull(declaration, values, is_emulator, bucket, key, session, target):
        print("error: could not read the state ledger")
        return 1
    state = _validate(target, declaration, is_emulator)
    os.chmod(target, 0o600)
    _write_meta(target, declaration, is_emulator, state.get("serial", 0))
    latest = default_snapshot(declaration, is_emulator)
    shutil.copy2(target, latest)
    shutil.copy2(meta_path(target), meta_path(latest))
    older = sorted(
        (p for p in folder.glob("*.tfstate") if p.name != "latest.tfstate"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old in older[KEEP_SNAPSHOTS - 1 :]:
        old.unlink(missing_ok=True)
        meta_path(old).unlink(missing_ok=True)
    print(f"saved: {latest} (serial {state.get('serial', 0)})")
    return 0


def load_snapshot(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
    source: Path,
    force: bool,
    dry_run: bool = False,
) -> int:
    if dry_run:
        print(f"would load: {source} -> {bucket} / {key}")
        return 0
    _validate(source, declaration, is_emulator)
    if not force and _ledger_exists(declaration, values, is_emulator, bucket, key, session):
        die(
            f"state ledger at {bucket} / {key} is not empty",
            "pass --force to overwrite it deliberately",
        )
    if ensure_state_bucket(declaration, values, is_emulator, plane_account(session, is_emulator), session, bucket) != 0:
        return 1
    if not _push(declaration, values, is_emulator, bucket, key, session, source):
        print("error: could not write the state ledger")
        return 1
    print(f"restored: {source} -> {bucket} / {key}")
    return 0


def ensure_state_ledger(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
) -> int:
    """Emulator only: restore the latest snapshot when the ledger has vanished."""
    if not is_emulator:
        return 0
    if _ledger_exists(declaration, values, is_emulator, bucket, key, session):
        return 0
    latest = default_snapshot(declaration, is_emulator)
    if not latest.is_file():
        # A brand-new stack legitimately has neither a ledger nor a snapshot;
        # the plan is the authority on what needs creating. The per-stack guard
        # (plan-guard for New Relic) still blocks a plan that would duplicate
        # live resources, so warn loudly and carry on.
        print(f"warning: state ledger at {bucket} / {key} is empty and no local snapshot exists ({latest} not found)")
        print("warning: check the plan before applying; restore a snapshot with `tfctl state-load` if this is unexpected")
        return 0
    print(f"note: state ledger is empty after emulator restart; restoring {latest}")
    return load_snapshot(
        declaration, values, is_emulator, bucket, key, session, latest, force=True
    )


def snapshot_after_apply(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
) -> int:
    """Emulator only: refresh the durable snapshot after a successful apply."""
    if not is_emulator:
        return 0
    return save_snapshot(declaration, values, is_emulator, bucket, key, session)


def state_status(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    bucket: str,
    key: str,
    session: dict[str, str] | None,
) -> int:
    print(f"plane:   {plane_display(is_emulator)}")
    print(f"state:   {bucket} / {key}")
    present = _ledger_exists(declaration, values, is_emulator, bucket, key, session)
    print(f"ledger:  {'present' if present else 'EMPTY'}")
    folder = snapshot_dir(declaration, is_emulator)
    snapshots = sorted(folder.glob("*.tfstate"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not snapshots:
        print("snapshots: none")
        return 0
    for snapshot in snapshots[:KEEP_SNAPSHOTS]:
        meta_file = meta_path(snapshot)
        meta = json.loads(meta_file.read_text()) if meta_file.is_file() else {}
        print(
            f"snapshot: {snapshot} (serial {meta.get('serial', '?')}, "
            f"saved {meta.get('saved_at', '?')})"
        )
    return 0


def state_store_flow(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    command: str,
    args: argparse.Namespace,
    session: dict[str, str] | None,
) -> int:
    account = plane_account(session, is_emulator)
    bucket = state_bucket_for(declaration.slug, account)
    key = state_key(declaration, is_emulator)
    if command == "state-status":
        return state_status(declaration, values, is_emulator, bucket, key, session)
    if command == "state-save":
        return save_snapshot(declaration, values, is_emulator, bucket, key, session, args.dry_run)
    if command == "state-load":
        source = Path(args.file) if args.file else default_snapshot(declaration, is_emulator)
        return load_snapshot(
            declaration, values, is_emulator, bucket, key, session, source, args.force, args.dry_run
        )
    raise AssertionError(f"{command} is not a state-store verb")
