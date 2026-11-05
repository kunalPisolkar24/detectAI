"""Subprocess runners: credential env composition, command shapes, and failure paths."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from conftest import EMULATOR_ENV, REAL_ENV
from app import proc

pytestmark = pytest.mark.unit


def test_aws_env_emulator_strips_the_profile_and_fakes_creds(monkeypatch):
    monkeypatch.setenv("AWS_PROFILE", "floci")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "stale-token")
    env = proc.aws_env(True)
    assert env["AWS_ACCESS_KEY_ID"] == "test" and env["AWS_SECRET_ACCESS_KEY"] == "test"
    assert "AWS_PROFILE" not in env
    assert "AWS_SESSION_TOKEN" not in env


def test_aws_env_injects_the_session_triplet_and_drops_the_profile(monkeypatch):
    monkeypatch.setenv("AWS_PROFILE", "sandbox")
    session = {"access_key_id": "A", "secret_access_key": "B", "session_token": "C"}
    env = proc.aws_env(False, session)
    assert env["AWS_ACCESS_KEY_ID"] == "A"
    assert env["AWS_SECRET_ACCESS_KEY"] == "B"
    assert env["AWS_SESSION_TOKEN"] == "C"
    assert "AWS_PROFILE" not in env


def test_aws_env_prefers_the_session_triplet_on_the_emulator_too(monkeypatch):
    monkeypatch.setenv("AWS_PROFILE", "floci")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "stale-token")
    session = {"access_key_id": "A", "secret_access_key": "B", "session_token": "C"}
    env = proc.aws_env(True, session)
    assert env["AWS_ACCESS_KEY_ID"] == "A"
    assert env["AWS_SECRET_ACCESS_KEY"] == "B"
    assert env["AWS_SESSION_TOKEN"] == "C"
    assert "AWS_PROFILE" not in env


def test_aws_env_leaves_the_ambient_environment_alone_off_both_planes(monkeypatch):
    monkeypatch.setenv("AWS_PROFILE", "personal")
    env = proc.aws_env(False, None)
    assert env["AWS_PROFILE"] == "personal"


def test_aws_base_pins_the_region_and_the_emulator_endpoint(dp):
    base = proc.aws_base(dp, EMULATOR_ENV, True)
    assert base[:5] == [
        "aws",
        "--region",
        "ap-southeast-2",
        "--endpoint-url",
        "http://localhost:4566",
    ]
    real = proc.aws_base(dp, REAL_ENV, False)
    assert real[:3] == ["aws", "--region", "ap-southeast-2"]
    assert "endpoint-url" not in real


def test_aws_base_honors_the_region_override(dp):
    base = proc.aws_base(dp, {**REAL_ENV, "AWS_REGION": "us-east-1"}, False)
    assert base[2] == "us-east-1"


def test_run_aws_prints_the_command_and_returns_the_returncode(monkeypatch, capsys):
    monkeypatch.setenv("AWS_PROFILE", "personal")
    seen = {}

    def run(command, check=False, env=None, **rest):
        seen["command"] = list(command)
        seen["env"] = dict(env or {})
        return SimpleNamespace(returncode=3)

    monkeypatch.setattr(proc.subprocess, "run", run)
    assert proc.run_aws(["aws", "sts"], False) == 3
    assert "running: aws sts" in capsys.readouterr().out
    assert "AWS_PROFILE" in seen["env"]  # ambient environment untouched off the emulator


def test_run_aws_captured_returns_the_streams(monkeypatch):
    monkeypatch.setattr(
        proc.subprocess,
        "run",
        lambda command, check=False, env=None, **rest: SimpleNamespace(
            returncode=0, stdout="out", stderr="err"
        ),
    )
    assert proc.run_aws_captured(["aws"], False) == (0, "out", "err")


def test_run_aws_dies_on_a_missing_binary(monkeypatch):
    def boom(*arguments, **rest):
        raise OSError("no aws")

    monkeypatch.setattr(proc.subprocess, "run", boom)
    with pytest.raises(SystemExit) as excinfo:
        proc.run_aws(["aws"], False)
    assert excinfo.value.code == 1


def test_die_prints_error_and_fix_and_exits_1(capsys):
    with pytest.raises(SystemExit) as excinfo:
        proc.die("boom", "fix it")
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "error: boom" in out and "fix:   fix it" in out


def test_run_terraform_composes_the_env_and_command(monkeypatch, tmp_path):
    monkeypatch.setattr(proc.shutil, "which", lambda name: "/usr/bin/terraform")
    seen = {}

    def run(command, check=False, env=None, **rest):
        seen["command"] = list(command)
        seen["env"] = dict(env or {})
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(proc.subprocess, "run", run)
    monkeypatch.setenv("AWS_PROFILE", "personal")
    overlay = {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
    code = proc.run_terraform(tmp_path, ["plan", "-input=false"], {"TF_VAR_blob": "{}"}, overlay)
    assert code == 0
    assert seen["command"] == ["/usr/bin/terraform", f"-chdir={tmp_path}", "plan", "-input=false"]
    assert seen["env"]["TF_VAR_blob"] == "{}"
    assert seen["env"]["AWS_ACCESS_KEY_ID"] == "test"
    assert "AWS_PROFILE" not in seen["env"]


def test_run_terraform_dies_without_terraform(monkeypatch):
    monkeypatch.setattr(proc.shutil, "which", lambda name: None)
    with pytest.raises(SystemExit) as excinfo:
        proc.run_terraform(".", ["plan"], {})
    assert excinfo.value.code == 1
