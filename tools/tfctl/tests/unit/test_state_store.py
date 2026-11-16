"""The local state ledger: snapshot validation, auto-restore, and the verb dispatch."""

from __future__ import annotations

import json

import pytest

from conftest import DP, EMULATOR_ENV, REAL_ENV, ROLE_ARN, fake_carrier_session, render_env, write_service
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
