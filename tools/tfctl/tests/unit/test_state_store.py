"""The local state ledger: snapshot validation, auto-restore, and the verb dispatch."""

from __future__ import annotations

import json
import os
import time
from types import SimpleNamespace

import pytest

from conftest import DP, EMULATOR_ENV, REAL_ENV, ROLE_ARN, render_env, write_service
from app import main as cli
from app.engine.stack import state_store as store

pytestmark = pytest.mark.unit

BUCKET = "detectai-document-parser-tfstate-000000000000"
KEY = "document-parser/floci/terraform.tfstate"
SESSION = {
    "role_arn": ROLE_ARN,
    "access_key_id": "ASIAFAKEID000000",
    "secret_access_key": "fake-secret",
    "session_token": "fake-token",
    "expires_at": "2086-01-01T00:00:00Z",
}


def _state(serial=7):
    return {"version": 4, "serial": serial, "lineage": "abc", "resources": []}


@pytest.fixture
def store_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TFCTL_STATE_BACKUP_DIR", str(tmp_path / "snapshots"))
    return tmp_path / "snapshots"


def _write_latest(store_dir, state=None):
    path = store.default_snapshot(DP, True)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {"slug": DP.slug, "plane": "floci", "serial": 7}
    store.meta_path(path).write_text(json.dumps(meta))
    path.write_text(json.dumps(state or _state()))
    return path


def test_validate_rejects_non_state_json(tmp_path):
    bad = tmp_path / "bad.tfstate"
    bad.write_text('{"hello": "world"}')
    with pytest.raises(SystemExit):
        store._validate(bad, DP, True)


def test_validate_rejects_a_snapshot_from_another_stack(tmp_path):
    path = tmp_path / "snap.tfstate"
    path.write_text(json.dumps(_state()))
    store.meta_path(path).write_text(json.dumps({"slug": "web", "plane": "floci", "serial": 7}))
    with pytest.raises(SystemExit) as excinfo:
        store._validate(path, DP, True)
    assert excinfo.value.code == 1


def test_validate_rejects_a_snapshot_from_another_plane(tmp_path):
    path = tmp_path / "snap.tfstate"
    path.write_text(json.dumps(_state()))
    store.meta_path(path).write_text(json.dumps({"slug": DP.slug, "plane": "aws", "serial": 7}))
    with pytest.raises(SystemExit):
        store._validate(path, DP, True)


def test_save_writes_latest_and_meta(store_dir, monkeypatch, capsys):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    monkeypatch.setattr(store, "_pull", lambda *a: a[-1].write_text(json.dumps(_state())) and True)
    assert store.save_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    latest = store.default_snapshot(DP, True)
    assert json.loads(latest.read_text())["serial"] == 7
    meta = json.loads(store.meta_path(latest).read_text())
    assert meta["slug"] == DP.slug and meta["plane"] == "floci"
    assert "saved:" in capsys.readouterr().out


def test_load_refuses_a_nonempty_ledger_without_force(store_dir, monkeypatch):
    source = _write_latest(store_dir)
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    with pytest.raises(SystemExit):
        store.load_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, source, False)


def test_load_overwrites_with_force(store_dir, monkeypatch, capsys):
    source = _write_latest(store_dir)
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    monkeypatch.setattr(store, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(store, "_push", lambda *a: True)
    assert store.load_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, source, True) == 0
    assert "restored:" in capsys.readouterr().out


def test_ensure_is_a_noop_on_aws(monkeypatch):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: False)
    assert store.ensure_state_ledger(DP, REAL_ENV, False, BUCKET, KEY, SESSION) == 0


def test_ensure_restores_an_empty_ledger(store_dir, monkeypatch, capsys):
    _write_latest(store_dir)
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: False)
    monkeypatch.setattr(store, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(store, "_push", lambda *a: True)
    assert store.ensure_state_ledger(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    assert "restoring" in capsys.readouterr().out


def test_ensure_warns_without_a_snapshot(store_dir, monkeypatch, capsys):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: False)
    assert store.ensure_state_ledger(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    out = capsys.readouterr().out
    assert "no local snapshot" in out and "check the plan before applying" in out


def test_after_apply_hook_is_emulator_only(monkeypatch):
    monkeypatch.setattr(store, "save_snapshot", lambda *a: 1)
    assert store.snapshot_after_apply(DP, REAL_ENV, False, BUCKET, KEY, SESSION) == 0
    assert store.snapshot_after_apply(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 1


def test_cli_dispatches_the_state_verbs(tmp_path, monkeypatch):
    workspace = write_service(tmp_path, render_env(EMULATOR_ENV))
    monkeypatch.setattr(cli, "resolve_carrier_session", lambda *a, **k: SESSION)
    seen = {}
    monkeypatch.setattr(
        cli,
        "state_store_flow",
        lambda decl, vals, emu, cmd, args, session: seen.update(cmd=cmd) or 0,
    )
    assert cli.main(["state-status", "--floci"], workspace=workspace) == 0
    assert seen == {"cmd": "state-status"}


def test_cli_hooks_plan_and_apply_on_floci_only(tmp_path, monkeypatch):
    workspace = write_service(tmp_path, render_env(EMULATOR_ENV))
    monkeypatch.setattr(cli, "resolve_carrier_session", lambda *a, **k: SESSION)
    import app.kinds.secrets.flow as stack_flow

    monkeypatch.setattr(stack_flow, "run_terraform", lambda *a, **k: 0)
    monkeypatch.setattr(stack_flow, "ensure_state_bucket", lambda *a, **k: 0)
    calls = []
    monkeypatch.setattr(cli, "ensure_state_ledger", lambda *a, **k: calls.append("ensure") or 0)
    monkeypatch.setattr(cli, "snapshot_after_apply", lambda *a, **k: calls.append("snapshot") or 0)

    assert cli.main(["plan"], workspace=workspace) == 0
    assert calls == ["ensure"]
    calls.clear()
    assert cli.main(["apply"], workspace=workspace) == 0
    assert calls == ["ensure", "snapshot"]


def test_validate_rejects_a_missing_file(tmp_path):
    with pytest.raises(SystemExit):
        store._validate(tmp_path / "missing.tfstate", DP, True)


def test_validate_rejects_unparseable_state(tmp_path):
    bad = tmp_path / "broken.tfstate"
    bad.write_text("{not json")
    with pytest.raises(SystemExit) as excinfo:
        store._validate(bad, DP, True)
    assert excinfo.value.code == 1


def test_validate_accepts_a_corrupt_meta_sidecar(tmp_path):
    bad_meta = tmp_path / "bad-meta.tfstate"
    bad_meta.write_text(json.dumps(_state()))
    store.meta_path(bad_meta).write_text("{not json")
    assert store._validate(bad_meta, DP, True) == _state()


def test_the_s3_helpers_report_whether_the_call_succeeded(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(store, "aws_base", lambda *a: ["BASE"])
    monkeypatch.setattr(
        store, "run_aws_captured", lambda cmd, emu, sess: calls.append(cmd) or (1, "", "")
    )
    assert store._ledger_exists(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) is False
    assert calls[-1] == ["BASE", "s3api", "head-object", "--bucket", BUCKET, "--key", KEY]

    monkeypatch.setattr(store, "run_aws_captured", lambda cmd, emu, sess: (0, "", ""))
    assert store._ledger_exists(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) is True

    target = tmp_path / "ledger.tfstate"
    target.write_text("{}")
    outcomes = [1, 0]
    monkeypatch.setattr(
        store, "run_aws", lambda cmd, emu, sess: calls.append(cmd) or outcomes.pop(0)
    )
    assert store._pull(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, target) is False
    assert calls[-1] == [
        "BASE",
        "s3api",
        "get-object",
        "--bucket",
        BUCKET,
        "--key",
        KEY,
        str(target),
    ]
    assert store._push(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, target) is True
    assert calls[-1] == [
        "BASE",
        "s3api",
        "put-object",
        "--bucket",
        BUCKET,
        "--key",
        KEY,
        "--body",
        str(target),
    ]


def test_save_has_a_dry_run_and_reports_an_empty_ledger(store_dir, monkeypatch, capsys):
    assert store.save_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, dry_run=True) == 0
    assert "would save:" in capsys.readouterr().out

    monkeypatch.setattr(store, "_ledger_exists", lambda *a: False)
    assert store.save_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    assert "nothing to save" in capsys.readouterr().out


def test_save_reports_a_failed_pull(store_dir, monkeypatch, capsys):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    monkeypatch.setattr(store, "_pull", lambda *a: False)
    assert store.save_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 1
    assert "could not read the state ledger" in capsys.readouterr().out


def test_save_keeps_only_the_ten_newest_snapshots(store_dir, monkeypatch):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    monkeypatch.setattr(store, "_pull", lambda *a: a[-1].write_text(json.dumps(_state())) and True)
    folder = store.snapshot_dir(DP, True)
    folder.mkdir(parents=True, exist_ok=True)
    old_epoch = time.time() - 10_000
    for index in range(12):
        snapshot = folder / f"20000101-0000{index:02d}.tfstate"
        snapshot.write_text(json.dumps(_state()))
        store.meta_path(snapshot).write_text(json.dumps({"slug": DP.slug, "plane": "floci"}))
        os.utime(snapshot, (old_epoch + index, old_epoch + index))
        os.utime(store.meta_path(snapshot), (old_epoch + index, old_epoch + index))

    assert store.save_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    snapshots = sorted(p.name for p in folder.glob("*.tfstate") if p.name != "latest.tfstate")
    assert len(snapshots) == store.KEEP_SNAPSHOTS - 1  # latest.tfstate is the tenth
    assert "20000101-000000.tfstate" not in snapshots
    assert not store.meta_path(folder / "20000101-000000.tfstate").exists()


def test_load_has_a_dry_run_and_reports_write_failures(store_dir, monkeypatch, capsys):
    source = _write_latest(store_dir)
    assert (
        store.load_snapshot(
            DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, source, False, dry_run=True
        )
        == 0
    )
    assert "would load:" in capsys.readouterr().out

    monkeypatch.setattr(store, "_ledger_exists", lambda *a: False)
    monkeypatch.setattr(store, "ensure_state_bucket", lambda *a, **k: 1)
    assert store.load_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, source, True) == 1

    monkeypatch.setattr(store, "ensure_state_bucket", lambda *a, **k: 0)
    monkeypatch.setattr(store, "_push", lambda *a: False)
    assert store.load_snapshot(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION, source, True) == 1
    assert "could not write the state ledger" in capsys.readouterr().out


def test_ensure_is_a_noop_when_the_ledger_is_present(monkeypatch):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    assert store.ensure_state_ledger(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0


def test_state_status_reports_an_empty_or_populated_ledger(store_dir, monkeypatch, capsys):
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: False)
    assert store.state_status(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    out = capsys.readouterr().out
    assert "ledger:  EMPTY" in out and "snapshots: none" in out

    _write_latest(store_dir)
    monkeypatch.setattr(store, "_ledger_exists", lambda *a: True)
    assert store.state_status(DP, EMULATOR_ENV, True, BUCKET, KEY, SESSION) == 0
    out = capsys.readouterr().out
    assert "ledger:  present" in out
    assert "serial 7" in out and "saved" in out


def test_state_store_flow_dispatches_and_refuses_unknown_verbs(store_dir, monkeypatch):
    seen = []
    monkeypatch.setattr(store, "state_status", lambda *a: seen.append("status") or 0)
    monkeypatch.setattr(store, "save_snapshot", lambda *a: seen.append("save") or 0)
    monkeypatch.setattr(store, "load_snapshot", lambda *a: seen.append("load") or 0)
    args = SimpleNamespace(dry_run=False, file=None, force=False)

    for command in ("state-status", "state-save", "state-load"):
        assert store.state_store_flow(DP, EMULATOR_ENV, True, command, args, SESSION) == 0
    assert seen == ["status", "save", "load"]

    with pytest.raises(AssertionError, match="is not a state-store verb"):
        store.state_store_flow(DP, EMULATOR_ENV, True, "plan", args, SESSION)
