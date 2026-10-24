"""Focused unit tests for tools/secrets.py.

The script is a plain file (not a package) and its name would shadow the
stdlib `secrets` module, so load it by path under an unambiguous name.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from typing import Any

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1]
SCRIPT = SERVICE_DIR / "tools" / "secrets.py"


def _load_script(path: Path) -> Any:
    spec = importlib.util.spec_from_file_location("dp_secrets", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load terraform script from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dp_secrets: Any = _load_script(SCRIPT)

VALID = {"API_KEY": "a" * 20}
EMULATOR_VALUE = {**VALID, "EMULATOR_ENDPOINT": "http://localhost:4566"}
REAL_VALUE = {**VALID, "TF_STATE_BUCKET": "detectai-tfstate-sandbox"}


def _field(hcl: str, key: str) -> str:
    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*(\S+)", hcl, re.MULTILINE)
    assert match is not None, f"{key} missing in: {hcl!r}"
    return match.group(1).strip('"')


def test_parse_env_file_strips_comments_and_keeps_first_duplicate(tmp_path, capsys):
    env = tmp_path / ".env"
    env.write_text(
        "A=one # inline comment\n"
        "# full comment line\n"
        "B= second \n"
        "A=two\n"
        "\n"
        "=oops\n"
    )
    assert dp_secrets.parse_env_file(env) == {"A": "one", "B": "second"}
    captured = capsys.readouterr().out
    assert "duplicate A" in captured
    assert "empty key" in captured


def test_valid_common_checks():
    assert dp_secrets.validate(True, EMULATOR_VALUE) == []
    assert dp_secrets.validate(False, REAL_VALUE) == []


def test_validate_rejects_short_api_key():
    errors = dp_secrets.validate(True, {"EMULATOR_ENDPOINT": "http://localhost:4566", "API_KEY": "short"})
    text = "\n".join(errors)
    assert "API_KEY" in text and "16" in text and "fix:" in text


def test_validate_rejects_bad_region_and_env_type():
    errors = "\n".join(
        dp_secrets.validate(
            True, {**EMULATOR_VALUE, "AWS_REGION": "STATE-ONE", "ENV_TYPE": "staging"}
        )
    )
    assert "AWS_REGION" in errors and "ENV_TYPE" in errors


def test_validate_emulator_plane_rejects_bad_endpoint():
    errors = "\n".join(dp_secrets.validate(True, {**VALID, "EMULATOR_ENDPOINT": "localhost:4566"}))
    assert "EMULATOR_ENDPOINT" in errors


def test_validate_real_plane_requires_bucket():
    errors = "\n".join(dp_secrets.validate(False, {**VALID, "TF_STATE_BUCKET": ""}))
    assert "TF_STATE_BUCKET" in errors and "make secrets-bootstrap-state" in errors


def test_validate_real_plane_rejects_bad_bucket_names():
    for bucket in ("A" * 20, "ok-but-", "-nope", "a", "detectai.tier", "z" * 64):
        errors = "\n".join(dp_secrets.validate(False, {**VALID, "TF_STATE_BUCKET": bucket}))
        assert "TF_STATE_BUCKET" in errors, bucket


def test_validate_real_plane_accepts_valid_bucket_names():
    assert dp_secrets.validate(False, {**VALID, "TF_STATE_BUCKET": "abc"}) == []
    assert dp_secrets.validate(False, {**VALID, "TF_STATE_BUCKET": "detectai-tfstate-123"}) == []


def test_build_tf_vars_maps_both_planes():
    emulator = dp_secrets.build_tf_vars(EMULATOR_VALUE)
    assert emulator["TF_VAR_emulator_endpoint"] == "http://localhost:4566"
    assert emulator["TF_VAR_secret_recovery_window"] == "0"

    real = dp_secrets.build_tf_vars(REAL_VALUE)
    assert "TF_VAR_emulator_endpoint" not in real
    assert real["TF_VAR_secret_recovery_window"] == "30"
    assert real["TF_VAR_aws_region"] == "ap-south-1"


def test_build_tf_vars_region_and_secret_name_overrides():
    values = {**EMULATOR_VALUE, "AWS_REGION": "us-east-1", "DP_API_KEY_SECRET_NAME": "detectai/document-parser/secrets-x"}
    mapped = dp_secrets.build_tf_vars(values)
    assert mapped["TF_VAR_aws_region"] == "us-east-1"
    assert mapped["TF_VAR_secrets_name"] == "detectai/document-parser/secrets-x"


def test_build_backend_hcl_emulator():
    hcl = dp_secrets.build_backend_hcl(True, EMULATOR_VALUE)
    assert _field(hcl, "bucket") == "detectai-tfstate-local"
    assert _field(hcl, "key").endswith("/floci/terraform.tfstate")
    assert _field(hcl, "encrypt") == "false"
    assert _field(hcl, "skip_credentials_validation") == "true"
    assert _field(hcl, "use_path_style") == "true"
    assert 's3 = "http://localhost:4566"' in hcl
    assert "use_lockfile" not in hcl


def test_build_backend_hcl_real_aws():
    hcl = dp_secrets.build_backend_hcl(False, REAL_VALUE)
    assert _field(hcl, "bucket") == "detectai-tfstate-sandbox"
    assert _field(hcl, "key") == "document-parser/terraform.tfstate"
    assert _field(hcl, "encrypt") == "true"
    assert _field(hcl, "use_lockfile") == "true"
    assert "endpoints" not in hcl
    assert "skip_credentials_validation" not in hcl


def test_build_backend_hcl_region_resolution():
    assert _field(dp_secrets.build_backend_hcl(True, EMULATOR_VALUE), "region") == "ap-south-1"
    custom = {**REAL_VALUE, "AWS_REGION": "us-east-1"}
    assert _field(dp_secrets.build_backend_hcl(False, custom), "region") == "us-east-1"


def test_resolve_state_bucket_defaults_and_overrides():
    # Emulator: unset falls back to the fixed local default; set passes through.
    assert dp_secrets.resolve_state_bucket(True, EMULATOR_VALUE) == "detectai-tfstate-local"
    custom = dp_secrets.resolve_state_bucket(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "docparser-sandbox-1"})
    assert custom == "docparser-sandbox-1"
    # Real AWS: unset stays None (validation rejects it); set passes through.
    assert dp_secrets.resolve_state_bucket(False, VALID) is None
    assert dp_secrets.resolve_state_bucket(False, REAL_VALUE) == "detectai-tfstate-sandbox"


def test_plane_notes_defaults_on_emulator_when_bucket_unset():
    defaulting = "\n".join(dp_secrets.plane_notes(EMULATOR_VALUE, "emulator (Floci)"))
    assert "defaults to detectai-tfstate-local" in defaulting
    custom = {**EMULATOR_VALUE, "TF_STATE_BUCKET": "docparser-sandbox-1"}
    assert all("defaults" not in note for note in dp_secrets.plane_notes(custom, "emulator (Floci)"))


def test_build_backend_hcl_emulator_honors_custom_bucket():
    hcl = dp_secrets.build_backend_hcl(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "docparser-sandbox-1"})
    assert _field(hcl, "bucket") == "docparser-sandbox-1"
    assert _field(hcl, "key").endswith("/floci/terraform.tfstate")


def test_validate_emulator_plane_rejects_bad_bucket_name():
    errors = "\n".join(dp_secrets.validate(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "Bad_Bucket"}))
    assert "TF_STATE_BUCKET" in errors and "valid S3 bucket name" in errors


def test_bootstrap_commands_emulator():
    commands = dp_secrets.bootstrap_commands(True, EMULATOR_VALUE)
    assert len(commands) == 2  # head-bucket then mb; no versioning pinning on the emulator
    assert commands[0][-3:] == ["head-bucket", "--bucket", "detectai-tfstate-local"]
    assert "--endpoint-url http://localhost:4566" in " ".join(commands[0])
    assert commands[1][-1] == "s3://detectai-tfstate-local"

    custom = dp_secrets.bootstrap_commands(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "docparser-sandbox-1"})
    assert custom[0][-3:] == ["head-bucket", "--bucket", "docparser-sandbox-1"]


def test_bootstrap_commands_real_aws():
    commands = dp_secrets.bootstrap_commands(False, REAL_VALUE)
    assert len(commands) == 3  # head-bucket, mb, put-bucket-versioning
    assert commands[0][-3:] == ["head-bucket", "--bucket", "detectai-tfstate-sandbox"]
    assert "endpoint-url" not in commands[0]
    assert commands[1][-1] == "s3://detectai-tfstate-sandbox"
    assert " ".join(commands[2]) == (
        "aws --region ap-south-1 s3api put-bucket-versioning "
        "--bucket detectai-tfstate-sandbox --versioning-configuration Status=Enabled"
    )


def test_validate_bootstrap_skips_key_and_env_type_checks():
    assert dp_secrets.validate_bootstrap(True, {"EMULATOR_ENDPOINT": "http://localhost:4566"}) == []
    assert dp_secrets.validate_bootstrap(False, {"TF_STATE_BUCKET": "detectai-tfstate-sandbox"}) == []


def test_validate_bootstrap_keeps_bucket_region_and_endpoint_checks():
    missing = "\n".join(dp_secrets.validate_bootstrap(False, {}))
    assert "TF_STATE_BUCKET" in missing

    bad_shape = "\n".join(
        dp_secrets.validate_bootstrap(True, {"EMULATOR_ENDPOINT": "http://localhost:4566", "TF_STATE_BUCKET": "Bad"})
    )
    assert "valid S3 bucket name" in bad_shape

    bad_plane = "\n".join(
        dp_secrets.validate_bootstrap(True, {"EMULATOR_ENDPOINT": "nope", "AWS_REGION": "Mars-1"})
    )
    assert "EMULATOR_ENDPOINT" in bad_plane and "AWS_REGION" in bad_plane


def test_warn_shell_conflicts_only_when_env_bucket_set(monkeypatch, capsys):
    monkeypatch.setenv("TF_STATE_BUCKET", "shell-bucket")
    dp_secrets.warn_shell_conflicts(EMULATOR_VALUE)  # .env bucket unset: nothing to conflict
    assert capsys.readouterr().out == ""
    dp_secrets.warn_shell_conflicts({**EMULATOR_VALUE, "TF_STATE_BUCKET": "docparser-sandbox-1"})
    assert "the .env value wins" in capsys.readouterr().out


def test_main_verb_args_per_plane(monkeypatch, tmp_path):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: calls.append(list(args)) or 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)

    env.write_text("API_KEY=" + "a" * 20 + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "apply"])
    assert dp_secrets.main() == 0
    assert calls[0][0] == "init"
    assert calls[-1] == ["apply"]  # real AWS keeps its confirmation prompt

    calls.clear()
    monkeypatch.setattr("sys.argv", ["secrets.py", "plan"])
    assert dp_secrets.main() == 0
    assert calls[-1] == ["plan", "-input=false"]

    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    calls.clear()
    monkeypatch.setattr("sys.argv", ["secrets.py", "apply"])
    assert dp_secrets.main() == 0
    assert calls[-1] == ["apply", "-input=false", "-auto-approve"]


def test_destroy_verb_args_per_plane(monkeypatch, tmp_path):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: calls.append(list(args)) or 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)

    env.write_text("API_KEY=" + "a" * 20 + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "destroy"])
    assert dp_secrets.main() == 0
    assert calls[-1] == ["destroy"]  # real AWS keeps its confirmation prompt

    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    calls.clear()
    monkeypatch.setattr("sys.argv", ["secrets.py", "destroy"])
    assert dp_secrets.main() == 0
    assert calls[-1] == ["destroy", "-input=false", "-auto-approve"]


def test_destroy_with_purge_runs_after_destroy(monkeypatch, tmp_path):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: calls.append(list(args)) or 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    monkeypatch.setattr(dp_secrets, "confirm_purge", lambda is_emulator, values: True)
    purged = []
    monkeypatch.setattr(
        dp_secrets, "purge_state", lambda is_emulator, values: purged.append(True) or 0
    )
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")

    monkeypatch.setattr("sys.argv", ["secrets.py", "destroy", "--purge-state"])
    assert dp_secrets.main() == 0
    assert calls[-1] == ["destroy", "-input=false", "-auto-approve"]
    assert purged == [True]  # the wipe runs only after terraform destroy succeeded

    calls.clear()
    monkeypatch.setattr("sys.argv", ["secrets.py", "clean"])  # invalid verb choice
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.main()
    assert excinfo.value.code == 2  # argparse rejects the verb


def test_destroy_dry_run_lists_purge_and_force_delete(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\n")

    monkeypatch.setattr(
        "sys.argv", ["secrets.py", "destroy", "--purge-state", "--force-delete", "--dry-run"]
    )
    assert dp_secrets.main() == 0
    out = capsys.readouterr().out
    assert "then terraform destroy" in out
    assert "purge: every object version in detectai-tfstate-sandbox" in out
    assert "--force-delete-without-recovery" in out

    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    monkeypatch.setattr(
        "sys.argv", ["secrets.py", "destroy", "--purge-state", "--force-delete", "--dry-run"]
    )
    assert dp_secrets.main() == 0
    out = capsys.readouterr().out
    assert "no effect on the emulator" in out  # recovery window is 0 there
    assert "--purge: every object version" in out or "purge: every object version" in out


def test_main_rejects_destroy_flags_on_other_verbs(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\n")

    monkeypatch.setattr("sys.argv", ["secrets.py", "apply", "--purge-state"])
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.main()
    assert excinfo.value.code == 1

    monkeypatch.setattr("sys.argv", ["secrets.py", "plan", "--force-delete"])
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.main()
    assert excinfo.value.code == 1


def test_effective_secret_name_resolution():
    assert dp_secrets.effective_secret_name(VALID) == "detectai/document-parser/secrets"
    assert dp_secrets.effective_secret_name({"DP_API_KEY_SECRET_NAME": ""}) == "detectai/document-parser/secrets"
    assert dp_secrets.effective_secret_name({"DP_API_KEY_SECRET_NAME": "custom/name"}) == "custom/name"


def test_purge_state_wipes_versions_and_delete_markers_then_bucket(monkeypatch, capsys):
    calls: list[list[str]] = []

    def fake_run_aws(command: list[str], is_emulator: bool) -> int:
        calls.append(list(command))
        return 0

    listing = {
        "Versions": [
            {"Key": "document-parser/terraform.tfstate", "VersionId": "v1"},
            {"Key": "chats/terraform.tfstate", "VersionId": "v2"},
        ],
        "DeleteMarkers": [
            {"Key": "document-parser/terraform.tflock", "VersionId": "d1"},
        ],
    }

    monkeypatch.setattr(dp_secrets, "run_aws", fake_run_aws)

    def fake_captured(command: list[str], is_emulator: bool) -> tuple[int, str, str]:
        calls.append(list(command))
        return 0, json.dumps(listing), ""

    monkeypatch.setattr(dp_secrets, "run_aws_captured", fake_captured)
    assert dp_secrets.purge_state(False, REAL_VALUE) == 0

    joined = [" ".join(call) for call in calls]
    assert "head-bucket" in joined[0]  # the purge walks over existing buckets only
    assert "list-object-versions" in joined[1]
    assert len([call for call in joined if "delete-object" in call]) == 3  # two versions + one marker
    assert "--version-id v1" in joined[2] and "--version-id v2" in joined[3] and "--version-id d1" in joined[4]
    assert joined[-1].endswith("delete-bucket --bucket detectai-tfstate-sandbox")
    assert all("detectai-tfstate-sandbox" in call for call in joined)
    assert "deleted: detectai-tfstate-sandbox" in capsys.readouterr().out


def test_purge_state_skips_missing_bucket(monkeypatch, capsys):
    def fake_run_aws(command: list[str], is_emulator: bool) -> int:
        return 255 if "head-bucket" in command else 0

    monkeypatch.setattr(dp_secrets, "run_aws", fake_run_aws)
    assert dp_secrets.purge_state(False, REAL_VALUE) == 0
    assert "already gone; nothing to purge" in capsys.readouterr().out


def test_confirm_purge_typed_barrier_on_real_plane(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)  # bucket exists
    listing = [("document-parser/terraform.tfstate", "v1"), ("chats/terraform.tfstate", "v2")]
    monkeypatch.setattr(dp_secrets, "list_bucket_versions", lambda is_emulator, values: listing)
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert dp_secrets.confirm_purge(False, REAL_VALUE) is False
    out = capsys.readouterr().out
    assert "purge will wipe 2 object version(s)" in out
    assert "outside document-parser/" in out  # sibling stacks in the shared sandbox are called out
    assert "cancelled: nothing was destroyed" in out

    monkeypatch.setattr(dp_secrets, "list_bucket_versions", lambda is_emulator, values: [])
    monkeypatch.setattr("builtins.input", lambda prompt="": "detectai-tfstate-sandbox")
    assert dp_secrets.confirm_purge(False, REAL_VALUE) is True


def test_confirm_purge_emulator_never_prompts(monkeypatch):
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)  # bucket exists
    monkeypatch.setattr(dp_secrets, "list_bucket_versions", lambda is_emulator, values: [])

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.confirm_purge(True, EMULATOR_VALUE) is True


def test_confirm_purge_bucket_missing_is_a_noop(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 255)  # head-bucket 404
    assert dp_secrets.confirm_purge(False, REAL_VALUE) is True
    assert "does not exist; the purge step will be a no-op" in capsys.readouterr().out
