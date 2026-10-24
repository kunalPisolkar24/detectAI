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
    assert real["TF_VAR_aws_region"] == "ap-southeast-2"


def test_build_tf_vars_region_override_and_pinned_secret_name():
    values = {**EMULATOR_VALUE, "AWS_REGION": "us-east-1"}
    mapped = dp_secrets.build_tf_vars(values)
    assert mapped["TF_VAR_aws_region"] == "us-east-1"
    assert "TF_VAR_secrets_name" not in mapped  # the contract name is terraform's own default


def test_build_backend_hcl_emulator():
    hcl = dp_secrets.build_backend_hcl(True, EMULATOR_VALUE)
    assert _field(hcl, "bucket") == "detectai-docparser-tfstate"
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
    assert _field(dp_secrets.build_backend_hcl(True, EMULATOR_VALUE), "region") == "ap-southeast-2"
    custom = {**REAL_VALUE, "AWS_REGION": "us-east-1"}
    assert _field(dp_secrets.build_backend_hcl(False, custom), "region") == "us-east-1"


def test_resolve_state_bucket_defaults_and_overrides():
    # Emulator: unset falls back to the fixed local default; set passes through.
    assert dp_secrets.resolve_state_bucket(True, EMULATOR_VALUE) == "detectai-docparser-tfstate"
    custom = dp_secrets.resolve_state_bucket(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "dp-tester-sandbox"})
    assert custom == "dp-tester-sandbox"
    # Real AWS: unset stays None (validation rejects it); set passes through.
    assert dp_secrets.resolve_state_bucket(False, VALID) is None
    assert dp_secrets.resolve_state_bucket(False, REAL_VALUE) == "detectai-tfstate-sandbox"


def test_plane_notes_defaults_on_emulator_when_bucket_unset():
    defaulting = "\n".join(dp_secrets.plane_notes(EMULATOR_VALUE, "emulator (Floci)"))
    assert "defaults to detectai-docparser-tfstate" in defaulting
    custom = {**EMULATOR_VALUE, "TF_STATE_BUCKET": "dp-tester-sandbox"}
    assert all("defaults" not in note for note in dp_secrets.plane_notes(custom, "emulator (Floci)"))


def test_build_backend_hcl_emulator_honors_custom_bucket():
    hcl = dp_secrets.build_backend_hcl(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "dp-tester-sandbox"})
    assert _field(hcl, "bucket") == "dp-tester-sandbox"
    assert _field(hcl, "key").endswith("/floci/terraform.tfstate")


def test_validate_emulator_plane_rejects_bad_bucket_name():
    errors = "\n".join(dp_secrets.validate(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "Bad_Bucket"}))
    assert "TF_STATE_BUCKET" in errors and "valid S3 bucket name" in errors


def test_bootstrap_commands_emulator():
    commands = dp_secrets.bootstrap_commands(True, EMULATOR_VALUE)
    assert len(commands) == 2  # head-bucket then mb; no versioning pinning on the emulator
    assert commands[0][-3:] == ["head-bucket", "--bucket", "detectai-docparser-tfstate"]
    assert "--endpoint-url http://localhost:4566" in " ".join(commands[0])
    assert commands[1][-1] == "s3://detectai-docparser-tfstate"

    custom = dp_secrets.bootstrap_commands(True, {**EMULATOR_VALUE, "TF_STATE_BUCKET": "dp-tester-sandbox"})
    assert custom[0][-3:] == ["head-bucket", "--bucket", "dp-tester-sandbox"]


def test_bootstrap_commands_real_aws():
    commands = dp_secrets.bootstrap_commands(False, REAL_VALUE)
    assert len(commands) == 3  # head-bucket, mb, put-bucket-versioning
    assert commands[0][-3:] == ["head-bucket", "--bucket", "detectai-tfstate-sandbox"]
    assert "endpoint-url" not in commands[0]
    assert commands[1][-1] == "s3://detectai-tfstate-sandbox"
    assert " ".join(commands[2]) == (
        "aws --region ap-southeast-2 s3api put-bucket-versioning "
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
    dp_secrets.warn_shell_conflicts({**EMULATOR_VALUE, "TF_STATE_BUCKET": "dp-tester-sandbox"})
    assert "the .env value wins" in capsys.readouterr().out


def test_main_verb_args_per_plane(monkeypatch, tmp_path):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: calls.append(list(args)) or 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    monkeypatch.setattr(dp_secrets, "ensure_state_bucket", lambda is_emulator, values: 0)
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
    monkeypatch.setattr(dp_secrets, "ensure_state_bucket", lambda is_emulator, values: 0)
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
    monkeypatch.setattr(dp_secrets, "ensure_state_bucket", lambda is_emulator, values: 0)
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


def test_force_delete_command_pins_the_contract_name():
    command = " ".join(dp_secrets.force_delete_command(False, REAL_VALUE))
    assert "--secret-id detectai/document-parser/secrets --force-delete-without-recovery" in command


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


def test_ensure_state_bucket_self_heals_missing_emulator_bucket(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (255, "", "NoSuchBucket"))
    created = []
    monkeypatch.setattr(
        dp_secrets, "bootstrap_state", lambda is_emulator, values, dry_run: created.append(dry_run) or 0
    )
    assert dp_secrets.ensure_state_bucket(True, EMULATOR_VALUE) == 0
    assert created == [False]  # a real, acting creation — never a dry run
    assert "detectai-docparser-tfstate is missing; creating it" in capsys.readouterr().out


def test_ensure_state_bucket_skips_existing_bucket_and_real_plane(monkeypatch, capsys):
    created = []
    monkeypatch.setattr(dp_secrets, "bootstrap_state", lambda *__: created.append(True) or 1)

    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))
    assert dp_secrets.ensure_state_bucket(True, EMULATOR_VALUE) == 0  # bucket exists: nothing to do

    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (255, "", "NoSuchBucket"))
    assert dp_secrets.ensure_state_bucket(False, REAL_VALUE) == 0  # real AWS never auto-creates
    assert created == []
    assert capsys.readouterr().out == ""


def test_apply_self_heals_the_emulator_bucket(monkeypatch, tmp_path):
    terraform_calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: terraform_calls.append(list(args)) or 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    created = []
    monkeypatch.setattr(
        dp_secrets, "bootstrap_state", lambda is_emulator, values, dry_run: created.append(dry_run) or 0
    )
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (255, "", "NoSuchBucket"))

    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "apply"])
    assert dp_secrets.main() == 0
    assert created == [False]  # the verb heals the plane before touching terraform
    assert terraform_calls[0][0] == "init"


def test_build_tf_vars_seeds_present_config_keys():
    values = {**EMULATOR_VALUE, "LOG_LEVEL": "DEBUG", "MAX_PDF_PAGES": "1200"}
    mapped = dp_secrets.build_tf_vars(values)
    assert json.loads(mapped["TF_VAR_ssm_parameters"]) == {"LOG_LEVEL": "DEBUG", "MAX_PDF_PAGES": "1200"}


def test_build_tf_vars_skips_absent_and_empty_config_keys():
    assert "TF_VAR_ssm_parameters" not in dp_secrets.build_tf_vars(EMULATOR_VALUE)
    assert "TF_VAR_ssm_parameters" not in dp_secrets.build_tf_vars({**EMULATOR_VALUE, "LOG_LEVEL": ""})


def test_build_tf_vars_ignores_unlisted_keys():
    values = {**EMULATOR_VALUE, "PORT": "8000", "RANDOM_THING": "v"}
    payload = json.loads(dp_secrets.build_tf_vars(values).get("TF_VAR_ssm_parameters", "{}"))
    assert "PORT" not in payload and "RANDOM_THING" not in payload


def test_iam_bootstrap_commands_emulator():
    commands = dp_secrets.iam_bootstrap_commands(True, EMULATOR_VALUE)
    assert len(commands) == 2
    create = " ".join(commands[0])
    assert "--role-name detectai-document-parser-deploy" in create
    assert "--endpoint-url http://localhost:4566" in create
    trust = json.loads(commands[0][commands[0].index("--assume-role-policy-document") + 1])
    statement = trust["Statement"][0]
    assert statement["Principal"]["AWS"] == "arn:aws:iam::000000000000:user/detectai-deploy"
    assert statement["Condition"]["Bool"]["aws:MultiFactorAuthPresent"] == "true"
    policy = json.loads(commands[1][commands[1].index("--policy-document") + 1])
    assert {part["Sid"] for part in policy["Statement"]} == {
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageServiceSecret",
        "ManageServiceConfig",
        "ManageRuntimeRole",
    }
    bucket_statement = next(part for part in policy["Statement"] if part["Sid"] == "RunTerraformStateBucket")
    assert bucket_statement["Resource"] == ["arn:aws:s3:::detectai-docparser-tfstate"]


def test_iam_bootstrap_commands_real_aws():
    real = {**REAL_VALUE, "DEPLOY_TRUST_USER_ARN": "arn:aws:iam::123456789012:user/kunalpisolkar"}
    commands = dp_secrets.iam_bootstrap_commands(False, real)
    assert "--endpoint-url" not in " ".join(commands[0])
    trust = json.loads(commands[0][commands[0].index("--assume-role-policy-document") + 1])
    assert trust["Statement"][0]["Principal"]["AWS"] == "arn:aws:iam::123456789012:user/kunalpisolkar"
    policy = json.loads(commands[1][commands[1].index("--policy-document") + 1])
    secret_statement = next(part for part in policy["Statement"] if part["Sid"] == "ManageServiceSecret")
    assert secret_statement["Resource"] == [
        "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:detectai/document-parser/secrets-*"
    ]
    role_statement = next(part for part in policy["Statement"] if part["Sid"] == "ManageRuntimeRole")
    assert role_statement["Resource"] == ["arn:aws:iam::123456789012:role/detectai-document-parser"]


def test_iam_bootstrap_policy_scope_is_service_pinned():
    real = {**REAL_VALUE, "DEPLOY_TRUST_USER_ARN": "arn:aws:iam::123456789012:user/kunalpisolkar"}
    policy = dp_secrets.deploy_policy_document(False, real, real["DEPLOY_TRUST_USER_ARN"])
    objects_statement = next(part for part in policy["Statement"] if part["Sid"] == "RunTerraformStateObjects")
    assert objects_statement["Resource"] == ["arn:aws:s3:::detectai-tfstate-sandbox/*"]
    config_statement = next(part for part in policy["Statement"] if part["Sid"] == "ManageServiceConfig")
    assert config_statement["Resource"] == [
        "arn:aws:ssm:ap-southeast-2:123456789012:parameter/detectai/document-parser/*"
    ]


def test_validate_iam_bootstrap_real_plane_requires_trust_user_arn():
    errors = "\n".join(dp_secrets.validate_iam_bootstrap(False, REAL_VALUE))
    assert "DEPLOY_TRUST_USER_ARN" in errors


def test_validate_iam_bootstrap_rejects_bad_user_arn():
    bad = {**REAL_VALUE, "DEPLOY_TRUST_USER_ARN": "arn:aws:iam::123:user/short-account-id"}
    errors = "\n".join(dp_secrets.validate_iam_bootstrap(False, bad))
    assert "DEPLOY_TRUST_USER_ARN" in errors
    errors = "\n".join(
        dp_secrets.validate_iam_bootstrap(
            True, {**EMULATOR_VALUE, "DEPLOY_TRUST_USER_ARN": "arn:aws:iam::x:user/oops"}
        )
    )
    assert "DEPLOY_TRUST_USER_ARN" in errors


def test_validate_iam_bootstrap_emulator_ok_without_user_arn():
    assert dp_secrets.validate_iam_bootstrap(True, EMULATOR_VALUE) == []


def test_iam_bootstrap_flow_dry_run_prints_and_runs_nothing(monkeypatch, capsys):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator: (calls.append(list(command)), (0, "", ""))[1],
    )
    assert dp_secrets.iam_bootstrap_flow(True, EMULATOR_VALUE, True) == 0
    assert calls == []  # dry run: nothing touches AWS
    out = capsys.readouterr().out
    assert "would run" in out and "iam create-role" in out


def test_iam_bootstrap_flow_emulator_never_prompts(monkeypatch):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.iam_bootstrap_flow(True, EMULATOR_VALUE, False) == 0


def test_iam_bootstrap_flow_keeps_existing_role(monkeypatch, capsys):
    results = iter([
        (1, "", "An error occurred (EntityAlreadyExists) when calling the CreateRole operation"),
        (0, "", ""),
    ])
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: next(results))
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)
    assert dp_secrets.iam_bootstrap_flow(True, EMULATOR_VALUE, False) == 0
    out = capsys.readouterr().out
    assert "already exists" in out and "policy: deploy-policy attached" in out


def test_iam_bootstrap_flow_fails_loud_when_role_creation_fails(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (299, "", "boom"))
    assert dp_secrets.iam_bootstrap_flow(True, EMULATOR_VALUE, False) == 1
    out = capsys.readouterr().out
    assert "create-role failed" in out and "boom" in out


def test_iam_bootstrap_main_wiring(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    started = []
    monkeypatch.setattr(
        dp_secrets, "iam_bootstrap_flow",
        lambda is_emulator, values, dry_run: started.append((is_emulator, dry_run)) or 0,
    )
    monkeypatch.setattr("sys.argv", ["secrets.py", "iam-bootstrap", "--dry-run"])
    assert dp_secrets.main() == 0
    assert started == [(True, True)]


def test_build_tf_vars_json_escapes_seed_values():
    values = {**EMULATOR_VALUE, "OTEL_EXPORTER_OTLP_ENDPOINT": "http://host:4318/?trailing=a=b"}
    payload = json.loads(dp_secrets.build_tf_vars(values)["TF_VAR_ssm_parameters"])
    assert payload["OTEL_EXPORTER_OTLP_ENDPOINT"] == "http://host:4318/?trailing=a=b"


def test_validate_iam_bootstrap_real_plane_requires_state_bucket():
    values = {**VALID, "DEPLOY_TRUST_USER_ARN": "arn:aws:iam::123456789012:user/kunalpisolkar"}
    errors = "\n".join(dp_secrets.validate_iam_bootstrap(False, values))
    assert "TF_STATE_BUCKET" in errors


def test_drop_iam_commands_detach_policy_before_deleting_role():
    commands = dp_secrets.drop_iam_commands(True, EMULATOR_VALUE)
    assert len(commands) == 2
    assert "iam delete-role-policy --role-name detectai-document-parser-deploy --policy-name deploy-policy" in " ".join(commands[0])
    assert "iam delete-role --role-name detectai-document-parser-deploy" in " ".join(commands[1])
    assert "--endpoint-url http://localhost:4566" in " ".join(commands[0])


def test_drop_iam_flow_dry_run_prints_and_runs_nothing(monkeypatch, capsys):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator: (calls.append(list(command)), (0, "", ""))[1],
    )
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: calls.append(list(command)) or 0)
    assert dp_secrets.drop_iam_flow(True, EMULATOR_VALUE, True) == 0
    assert calls == []  # dry run: nothing touches AWS
    assert "would run" in capsys.readouterr().out


def test_drop_iam_flow_acts_in_order_on_emulator(monkeypatch, capsys):
    run_calls: list[list[str]] = []
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))  # role exists
    monkeypatch.setattr(
        dp_secrets, "run_aws", lambda command, is_emulator: run_calls.append(list(command)) or 0
    )

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.drop_iam_flow(True, EMULATOR_VALUE, False) == 0
    joined = [" ".join(call) for call in run_calls]
    assert "iam delete-role-policy" in joined[0]
    assert "iam delete-role" in joined[1]  # the role goes only after its policy
    out = capsys.readouterr().out
    assert "detached: deploy-policy" in out and "deleted: detectai-document-parser-deploy" in out


def test_drop_iam_flow_skips_missing_role(monkeypatch, capsys):
    run_calls: list[list[str]] = []
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (255, "", ""))
    monkeypatch.setattr(
        dp_secrets, "run_aws", lambda command, is_emulator: run_calls.append(list(command)) or 0
    )
    assert dp_secrets.drop_iam_flow(True, EMULATOR_VALUE, False) == 0
    assert run_calls == []  # nothing to drop: no mutations ran
    assert "nothing to drop" in capsys.readouterr().out


def test_drop_iam_flow_real_plane_typed_barrier(monkeypatch, capsys):
    run_calls: list[list[str]] = []
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))  # role exists
    monkeypatch.setattr(
        dp_secrets, "run_aws", lambda command, is_emulator: run_calls.append(list(command)) or 0
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert dp_secrets.drop_iam_flow(False, REAL_VALUE, False) == 1
    assert run_calls == []  # refusal keeps the role

    monkeypatch.setattr("builtins.input", lambda prompt="": "detectai-document-parser-deploy")
    assert dp_secrets.drop_iam_flow(False, REAL_VALUE, False) == 0
    assert len(run_calls) == 2
    assert "cancelled" in capsys.readouterr().out


def test_drop_iam_flow_fails_loud_when_policy_detach_fails(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))  # role exists
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 1)
    assert dp_secrets.drop_iam_flow(True, EMULATOR_VALUE, False) == 1
    assert "detach deploy-policy manually" in capsys.readouterr().out


def test_full_destroy_wipes_then_drops(monkeypatch, tmp_path):
    sequence: list[str] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))
    monkeypatch.setattr(dp_secrets, "purge_state", lambda is_emulator, values: sequence.append("purge") or 0)
    monkeypatch.setattr(
        dp_secrets, "drop_iam_flow",
        lambda is_emulator, values, dry_run: sequence.append("drop") or 0,
    )
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "destroy", "--purge-state", "--drop-iam"])
    assert dp_secrets.main() == 0
    assert sequence == ["purge", "drop"]  # bucket wiped before the identity is dropped


def test_main_rejects_drop_iam_on_other_verbs(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "apply", "--drop-iam"])
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.main()
    assert excinfo.value.code == 1
