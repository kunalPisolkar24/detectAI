"""CLI surface: verb wiring, banners, flag guards, and the signal net."""

from __future__ import annotations

import pytest

from conftest import EMULATOR_ENV, REAL_ENV, fake_carrier_session, render_env, write_service
from app import config, main as cli
from app import verify as verify_module

pytestmark = pytest.mark.unit


def ws_with(tmp_path, values: dict[str, str]):
    workspace = write_service(tmp_path, render_env(values))
    return workspace


def test_invalid_verb_exits_2(ws_env):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["nope"], workspace=ws_env)
    assert excinfo.value.code == 2


def test_destroy_only_flags_guard_every_other_verb(ws_env, capsys):
    for verb, flag in (
        ("plan", "--purge-state"),
        ("apply", "--force-delete"),
        ("verify", "--drop-seeder"),
    ):
        with pytest.raises(SystemExit) as excinfo:
            cli.main([verb, flag], workspace=ws_env)
        assert excinfo.value.code == 1
    assert "only applies to the destroy command" in capsys.readouterr().out


def test_session_clear_removes_the_cache_file(tmp_path):
    workspace = write_service(tmp_path, "")
    cache = workspace.session_cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text("{}")
    assert cli.main(["session-clear"], workspace=workspace) == 0
    assert not cache.exists()

    assert cli.main(["session-clear"], workspace=workspace) == 0  # rerun is a no-op


def test_session_clear_runs_before_the_declaration_load(tmp_path):
    workspace = config.workspace_for(tmp_path)  # no secrets.toml at all
    cache = workspace.session_cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text("{}")
    assert cli.main(["session-clear"], workspace=workspace) == 0
    assert not cache.exists()


def test_missing_values_file_dies(tmp_path, capsys):
    workspace = write_service(tmp_path, None)
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["plan"], workspace=workspace)
    assert excinfo.value.code == 1
    assert "not found" in capsys.readouterr().out


def test_bad_declaration_dies_with_a_fix_hint(tmp_path):
    (tmp_path / "secrets.toml").write_text("[nonsense]\n")
    workspace = config.workspace_for(tmp_path)
    (workspace.values_file.parent).mkdir(parents=True, exist_ok=True)
    workspace.values_file.write_text("")
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["plan"], workspace=workspace)
    assert excinfo.value.code == 1


def test_verify_wiring(dp, tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    seen = {}

    def fake_flow(declaration, values, is_emulator, dry_run, session=None):
        seen["call"] = (declaration, values, is_emulator, dry_run, session)
        return 0

    monkeypatch.setattr(verify_module, "verify_flow", fake_flow)
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["verify"], workspace=workspace) == 0
    declaration, values, is_emulator, dry_run, session = seen["call"]
    assert declaration.slug == "document-parser"
    assert values == EMULATOR_ENV
    assert is_emulator is True and dry_run is False
    assert session == fake_carrier_session(None, None, True, False)


def test_verify_validation_failure_short_circuits(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, {"API_KEY": "a" * 20, "AWS_REGION": "STATE-ONE"})

    def boom(*arguments, **rest):
        raise AssertionError("a failed validation must not reach the flow")

    monkeypatch.setattr(verify_module, "verify_flow", boom)
    assert cli.main(["verify"], workspace=workspace) == 1


def test_seeder_verb_wiring(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    seen = {}

    def fake_drop(declaration, values, is_emulator, dry_run):
        seen["drop"] = True
        return 0

    monkeypatch.setattr(cli, "drop_seeder_flow", fake_drop)
    assert cli.main(["seeder-drop"], workspace=workspace) == 0
    assert seen == {"drop": True}

    with pytest.raises(SystemExit) as excinfo:
        cli.main(["seeder-bootstrap"], workspace=workspace)
    assert excinfo.value.code == 2


def test_plane_selection_defaults_to_floci_and_follows_the_flags(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    seen = {}

    def fake_flow(declaration, values, is_emulator, dry_run, session=None):
        seen["is_emulator"] = is_emulator
        return 0

    monkeypatch.setattr(verify_module, "verify_flow", fake_flow)
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["verify"], workspace=workspace) == 0
    assert seen["is_emulator"] is True  # the default plane

    assert cli.main(["verify", "--floci"], workspace=workspace) == 0
    assert seen["is_emulator"] is True  # explicit, same plane

    assert cli.main(["verify", "--aws"], workspace=workspace) == 0
    assert seen["is_emulator"] is False


def test_floci_and_aws_flags_are_mutually_exclusive(ws_env):
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["plan", "--floci", "--aws"], workspace=ws_env)
    assert excinfo.value.code == 2


def test_legacy_emulator_endpoint_key_is_ignored_with_a_note(tmp_path, monkeypatch, capsys):
    workspace = ws_with(tmp_path, {**EMULATOR_ENV, "EMULATOR_ENDPOINT": "http://elsewhere:4566"})
    seen = {}

    def fake_flow(declaration, values, is_emulator, dry_run, session=None):
        seen["is_emulator"] = is_emulator
        return 0

    monkeypatch.setattr(verify_module, "verify_flow", fake_flow)
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["verify"], workspace=workspace) == 0
    assert seen["is_emulator"] is True  # the flag decides, never the file
    assert "EMULATOR_ENDPOINT in the values file is ignored" in capsys.readouterr().out


def test_plan_dry_run_prints_the_backend_and_never_runs_terraform(tmp_path, monkeypatch, capsys):
    workspace = ws_with(tmp_path, EMULATOR_ENV)

    def boom(*arguments, **rest):
        raise AssertionError("dry run must not run terraform")

    monkeypatch.setattr(cli, "run_terraform", boom)
    monkeypatch.setattr(cli, "ensure_state_bucket", boom)
    assert cli.main(["plan", "--dry-run"], workspace=workspace) == 0
    out = capsys.readouterr().out
    assert "backend overrides (written to a temp .hcl at run time):" in out
    assert "terraform init -reconfigure -backend-config <backend.hcl>, then terraform plan" in out
    assert "(dry run: no terraform, no AWS writes)" in out


def test_plan_runs_init_then_plan_on_the_emulator(tmp_path, monkeypatch, capsys):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    calls = []

    def fake_run_terraform(tf_dir, args, tf_vars, env_overlay=None):
        calls.append((tf_dir, list(args), dict(tf_vars), dict(env_overlay or {})))
        return 0

    monkeypatch.setattr(cli, "run_terraform", fake_run_terraform)
    monkeypatch.setattr(
        cli,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None: 0,
    )
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["plan"], workspace=workspace) == 0

    assert len(calls) == 2
    init_args, plan_args = calls[0][1], calls[1][1]
    assert init_args[:3] == ["init", "-reconfigure", "-backend-config"]
    assert plan_args == ["plan", "-input=false"]
    tf_vars = calls[0][2]
    assert tf_vars["TF_VAR_service_slug"] == "document-parser"
    assert tf_vars["TF_VAR_emulator_endpoint"] == "http://localhost:4566"
    assert tf_vars["TF_VAR_secret_recovery_window"] == "0"
    session = fake_carrier_session(None, None, True, False)
    assert calls[0][3] == {
        "AWS_ACCESS_KEY_ID": session["access_key_id"],
        "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
        "AWS_SESSION_TOKEN": session["session_token"],
    }

    out = capsys.readouterr().out
    assert "plane:   floci (emulator http://localhost:4566)" in out
    assert "carrier: role session (detectai-document-parser-seeder, valid " in out
    assert "secret: detectai/document-parser/secrets" in out
    assert "keys:    API_KEY *** (20 chars, hidden)" in out
    assert (
        "state:  detectai-document-parser-tfstate-000000000000 / document-parser/floci/terraform.tfstate"
        in out
    )
    assert "window: 0 day(s)" in out


def test_apply_on_real_aws_uses_the_session_triplet(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, REAL_ENV)
    calls = []

    def fake_run_terraform(tf_dir, args, tf_vars, env_overlay=None):
        calls.append((list(args), dict(env_overlay or {})))
        return 0

    monkeypatch.setattr(cli, "run_terraform", fake_run_terraform)
    monkeypatch.setattr(
        cli,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None: 0,
    )
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["apply", "--aws"], workspace=workspace) == 0

    apply_args, overlay = calls[1]
    assert apply_args == ["apply"]  # real AWS keeps its own confirm prompt
    session = fake_carrier_session(None, None, False, False)
    assert overlay["AWS_ACCESS_KEY_ID"] == session["access_key_id"]
    assert overlay["AWS_SESSION_TOKEN"] == session["session_token"]


def test_destroy_chain_on_the_emulator_runs_purge_then_seeder_drop(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    order = []

    def fake_confirm(declaration, values, is_emulator, account, session=None):
        order.append("confirm")
        return True

    def fake_run_terraform(tf_dir, args, tf_vars, env_overlay=None):
        order.append(" ".join(args))
        return 0

    def fake_purge(declaration, values, is_emulator, account, session=None):
        order.append("purge")
        return 0

    def fake_drop(declaration, values, is_emulator, dry_run):
        order.append("drop")
        return 0

    monkeypatch.setattr(cli, "confirm_purge", fake_confirm)
    monkeypatch.setattr(cli, "run_terraform", fake_run_terraform)
    monkeypatch.setattr(cli, "purge_state", fake_purge)
    monkeypatch.setattr(cli, "drop_seeder_flow", fake_drop)
    monkeypatch.setattr(
        cli,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None: 0,
    )
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)

    arguments = ["destroy", "--purge-state", "--force-delete", "--drop-seeder"]
    assert cli.main(arguments, workspace=workspace) == 0
    assert order[0] == "confirm"  # the barrier comes before any terraform
    assert "destroy -input=false -auto-approve" in order
    assert order[-2:] == ["purge", "drop"]


def test_destroy_refused_purge_aborts_before_terraform(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    monkeypatch.setattr(
        cli, "confirm_purge", lambda declaration, values, is_emulator, account, session=None: False
    )
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)

    def boom(*arguments, **rest):
        raise AssertionError("a refused purge must abort before terraform")

    monkeypatch.setattr(cli, "run_terraform", boom)
    assert cli.main(["destroy", "--purge-state"], workspace=workspace) == 1


def test_destroy_force_delete_on_real_aws_runs_the_cli_delete(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, REAL_ENV)
    seen = {}

    def fake_run_aws(command, is_emulator, session=None):
        seen["command"] = list(command)
        seen["session"] = session
        return 0

    monkeypatch.setattr(cli, "run_aws", fake_run_aws)
    monkeypatch.setattr(cli, "run_terraform", lambda tf_dir, args, tf_vars, env_overlay=None: 0)
    monkeypatch.setattr(
        cli,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None: 0,
    )
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["destroy", "--force-delete", "--aws"], workspace=workspace) == 0
    command = " ".join(seen["command"])
    assert "--secret-id detectai/document-parser/secrets" in command
    assert "--force-delete-without-recovery" in command
    assert seen["session"] is not None  # the delete runs on the carrier session


def test_destroy_purge_failure_aborts_before_the_seeder_drop(tmp_path, monkeypatch):
    workspace = ws_with(tmp_path, EMULATOR_ENV)
    monkeypatch.setattr(
        cli, "confirm_purge", lambda declaration, values, is_emulator, account, session=None: True
    )
    monkeypatch.setattr(cli, "run_terraform", lambda tf_dir, args, tf_vars, env_overlay=None: 0)
    monkeypatch.setattr(
        cli, "purge_state", lambda declaration, values, is_emulator, account, session=None: 1
    )

    def boom(*arguments, **rest):
        raise AssertionError("a failed purge must abort before the seeder drop")

    monkeypatch.setattr(cli, "drop_seeder_flow", boom)
    monkeypatch.setattr(
        cli,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None: 0,
    )
    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    assert cli.main(["destroy", "--purge-state", "--drop-seeder"], workspace=workspace) == 1


def test_cli_main_translates_interrupt_and_eof(monkeypatch):
    def interrupt():
        raise KeyboardInterrupt

    def eof():
        raise EOFError

    monkeypatch.setattr(cli, "main", interrupt)
    assert cli.cli_main() == 130
    monkeypatch.setattr(cli, "main", eof)
    assert cli.cli_main() == 1


def test_find_service_workspace_resolves_by_name_and_walks_up(monkeypatch):
    workspace = cli.find_service_workspace(cli.REPO_ROOT, "document-parser")
    assert workspace.service_dir.name == "document-parser"
    assert workspace.values_file == workspace.service_dir / "infra" / ".env"

    monkeypatch.chdir(cli.REPO_ROOT / "services" / "document-parser" / "infra")
    walked = cli.find_service_workspace(cli.REPO_ROOT, None)
    assert walked.service_dir.name == "document-parser"


def test_find_service_workspace_dies_on_an_unknown_service():
    with pytest.raises(SystemExit) as excinfo:
        cli.find_service_workspace(cli.REPO_ROOT, "no-such-service")
    assert excinfo.value.code == 1


def test_values_file_flag_rebuilds_the_workspace(tmp_path, monkeypatch):
    workspace = write_service(tmp_path, render_env(EMULATOR_ENV))
    central = tmp_path / "central.env"
    central.write_text(render_env(EMULATOR_ENV))
    seen = {}

    monkeypatch.setattr(cli, "resolve_carrier_session", fake_carrier_session)
    monkeypatch.setattr(
        cli,
        "ensure_state_bucket",
        lambda declaration, values, is_emulator, account, session=None: 0,
    )

    def fake_run_terraform(tf_dir, args, tf_vars, env_overlay=None):
        seen["tf_dir"] = tf_dir
        return 0

    monkeypatch.setattr(cli, "run_terraform", fake_run_terraform)
    assert cli.main(["plan", "--values-file", str(central)], workspace=workspace) == 0
    assert seen["tf_dir"] == config.PLANE_ROOT  # the stack stays put; only the values move
