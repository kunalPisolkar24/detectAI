"""Focused unit tests for tools/secrets.py.

The script is a plain file (not a package) and its name would shadow the
stdlib `secrets` module, so load it by path under an unambiguous name.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

SERVICE_DIR = Path(__file__).resolve().parents[3]
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

USER_ARN = "arn:aws:iam::123456789012:user/kunalpisolkar"
ROLE_ARN = "arn:aws:iam::123456789012:role/detectai-document-parser-seeder"


def fake_carrier_session(is_emulator: bool, values: Any, dry_run: bool) -> Any:
    """Stand-in for resolve_carrier_session: None off the real plane, otherwise a
    far-future session — real-plane main() tests stay hermetic and land on AWS."""
    return (
        None
        if is_emulator or dry_run
        else {
            "role_arn": ROLE_ARN,
            "access_key_id": "ASIAFAKEID000000",
            "secret_access_key": "fake-secret",
            "session_token": "fake-token",
            "expires_at": "2086-01-01T00:00:00Z",
        }
    )


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


def test_validate_rejects_an_endpoint_without_a_url_shape():
    errors = dp_secrets.validate(True, {**EMULATOR_VALUE, "OTEL_EXPORTER_OTLP_ENDPOINT": "localhost:4318"})
    text = "\n".join(errors)
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" in text and "http(s)" in text and "fix:" in text


def test_validate_rejects_an_endpoint_without_a_license_key():
    errors = dp_secrets.validate(
        True, {**EMULATOR_VALUE, "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"}
    )
    text = "\n".join(errors)
    assert "NEW_RELIC_LICENSE_KEY" in text and "16" in text and "fix:" in text
    # The unset endpoint is the legitimate disabled stack: no key is demanded.
    assert dp_secrets.validate(True, EMULATOR_VALUE) == []


def test_validate_accepts_a_set_endpoint_with_a_key_over_the_floor():
    values = {
        **REAL_VALUE,
        "OTEL_EXPORTER_OTLP_ENDPOINT": "https://otlp.nr-data.net",
        "NEW_RELIC_LICENSE_KEY": "d" * 20,
    }
    assert dp_secrets.validate(False, values) == []
    assert dp_secrets.validate(True, {**values, "EMULATOR_ENDPOINT": "http://localhost:4566"}) == []

    short = {**values, "NEW_RELIC_LICENSE_KEY": "d" * 8}
    assert "NEW_RELIC_LICENSE_KEY" in "\n".join(dp_secrets.validate(False, short))


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
    monkeypatch.setattr(dp_secrets, "resolve_carrier_session", fake_carrier_session)
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
    monkeypatch.setattr(dp_secrets, "resolve_carrier_session", fake_carrier_session)
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
    monkeypatch.setattr(dp_secrets, "confirm_purge", lambda is_emulator, values, session=None: True)
    purged = []
    monkeypatch.setattr(
        dp_secrets, "purge_state", lambda is_emulator, values, session=None: purged.append(True) or 0
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

    def fake_run_aws(command: list[str], is_emulator: bool, session=None) -> int:
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

    def fake_captured(command: list[str], is_emulator: bool, session=None) -> tuple[int, str, str]:
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
    def fake_run_aws(command: list[str], is_emulator: bool, session=None) -> int:
        return 255 if "head-bucket" in command else 0

    monkeypatch.setattr(dp_secrets, "run_aws", fake_run_aws)
    assert dp_secrets.purge_state(False, REAL_VALUE) == 0
    assert "already gone; nothing to purge" in capsys.readouterr().out


def test_confirm_purge_typed_barrier_on_real_plane(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator, session=None: 0)  # bucket exists
    listing = [("document-parser/terraform.tfstate", "v1"), ("chats/terraform.tfstate", "v2")]
    monkeypatch.setattr(dp_secrets, "list_bucket_versions", lambda is_emulator, values, session=None: listing)
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert dp_secrets.confirm_purge(False, REAL_VALUE) is False
    out = capsys.readouterr().out
    assert "purge will wipe 2 object version(s)" in out
    assert "outside document-parser/" in out  # sibling stacks in the shared sandbox are called out
    assert "cancelled: nothing was destroyed" in out

    monkeypatch.setattr(dp_secrets, "list_bucket_versions", lambda is_emulator, values, session=None: [])
    monkeypatch.setattr("builtins.input", lambda prompt="": "detectai-tfstate-sandbox")
    assert dp_secrets.confirm_purge(False, REAL_VALUE) is True


def test_confirm_purge_emulator_never_prompts(monkeypatch):
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator, session=None: 0)  # bucket exists
    monkeypatch.setattr(dp_secrets, "list_bucket_versions", lambda is_emulator, values, session=None: [])

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.confirm_purge(True, EMULATOR_VALUE) is True


def test_confirm_purge_bucket_missing_is_a_noop(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator, session=None: 255)  # head-bucket 404
    assert dp_secrets.confirm_purge(False, REAL_VALUE) is True
    assert "does not exist; the purge step will be a no-op" in capsys.readouterr().out


def test_ensure_state_bucket_self_heals_missing_emulator_bucket(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator, session=None: (255, "", "NoSuchBucket"))
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

    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator, session=None: (0, "", ""))
    assert dp_secrets.ensure_state_bucket(True, EMULATOR_VALUE) == 0  # bucket exists: nothing to do

    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator, session=None: (255, "", "NoSuchBucket"))
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
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator, session=None: (255, "", "NoSuchBucket"))

    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "apply"])
    assert dp_secrets.main() == 0
    assert created == [False]  # the verb heals the plane before touching terraform
    assert terraform_calls[0][0] == "init"


def test_build_tf_vars_seeds_present_config_keys():
    values = {**EMULATOR_VALUE, "OTEL_TRACE_SAMPLE_RATIO": "0.5", "MAX_PDF_PAGES": "1200"}
    mapped = dp_secrets.build_tf_vars(values)
    assert json.loads(mapped["TF_VAR_ssm_parameters"]) == {
        "OTEL_TRACE_SAMPLE_RATIO": "0.5",
        "MAX_PDF_PAGES": "1200",
    }


def test_build_tf_vars_skips_absent_and_empty_config_keys():
    assert "TF_VAR_ssm_parameters" not in dp_secrets.build_tf_vars(EMULATOR_VALUE)
    assert "TF_VAR_ssm_parameters" not in dp_secrets.build_tf_vars({**EMULATOR_VALUE, "OTEL_TRACE_SAMPLE_RATIO": ""})


def test_build_tf_vars_ignores_unlisted_keys():
    values = {**EMULATOR_VALUE, "PORT": "8000", "RANDOM_THING": "v"}
    payload = json.loads(dp_secrets.build_tf_vars(values).get("TF_VAR_ssm_parameters", "{}"))
    assert "PORT" not in payload and "RANDOM_THING" not in payload


def test_seeder_bootstrap_commands_emulator():
    commands = dp_secrets.seeder_bootstrap_commands(True, EMULATOR_VALUE)
    assert len(commands) == 3
    create = " ".join(commands[0])
    assert "--role-name detectai-document-parser-seeder" in create
    assert "--endpoint-url http://localhost:4566" in create
    assert "--max-session-duration 43200" in create
    trust = json.loads(commands[0][commands[0].index("--assume-role-policy-document") + 1])
    statement = trust["Statement"][0]
    assert statement["Principal"]["AWS"] == "arn:aws:iam::000000000000:user/detectai-seeder"
    assert statement["Condition"]["Bool"]["aws:MultiFactorAuthPresent"] == "true"
    update = " ".join(commands[1])
    assert "iam update-role --role-name detectai-document-parser-seeder" in update
    assert "--max-session-duration 43200" in update
    policy = json.loads(commands[2][commands[2].index("--policy-document") + 1])
    assert {part["Sid"] for part in policy["Statement"]} == {
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageServiceSecret",
        "ManageServiceConfig",
        "DescribeSsmParameters",
    }
    bucket_statement = next(part for part in policy["Statement"] if part["Sid"] == "RunTerraformStateBucket")
    assert bucket_statement["Resource"] == ["arn:aws:s3:::detectai-docparser-tfstate"]


def test_seeder_bootstrap_commands_real_aws():
    real = {**REAL_VALUE, "SEEDER_TRUST_USER_ARN": "arn:aws:iam::123456789012:user/kunalpisolkar"}
    commands = dp_secrets.seeder_bootstrap_commands(False, real)
    joined = " ".join(" ".join(command) for command in commands)
    assert "--endpoint-url" not in joined
    assert joined.count("--max-session-duration 43200") == 2  # create and update both carry the cap
    trust = json.loads(commands[0][commands[0].index("--assume-role-policy-document") + 1])
    assert trust["Statement"][0]["Principal"]["AWS"] == "arn:aws:iam::123456789012:user/kunalpisolkar"
    policy = json.loads(commands[2][commands[2].index("--policy-document") + 1])
    secret_statement = next(part for part in policy["Statement"] if part["Sid"] == "ManageServiceSecret")
    assert secret_statement["Resource"] == [
        "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:detectai/document-parser/secrets-*"
    ]


def test_seeder_bootstrap_policy_scope_is_service_pinned():
    real = {**REAL_VALUE, "SEEDER_TRUST_USER_ARN": "arn:aws:iam::123456789012:user/kunalpisolkar"}
    policy = dp_secrets.seeder_policy_document(False, real, real["SEEDER_TRUST_USER_ARN"])
    objects_statement = next(part for part in policy["Statement"] if part["Sid"] == "RunTerraformStateObjects")
    assert objects_statement["Resource"] == ["arn:aws:s3:::detectai-tfstate-sandbox/*"]
    config_statement = next(part for part in policy["Statement"] if part["Sid"] == "ManageServiceConfig")
    assert config_statement["Resource"] == [
        "arn:aws:ssm:ap-southeast-2:123456789012:parameter/detectai/document-parser/*"
    ]
    # DescribeParameters is the one account-level API; every other statement stays ARN-pinned.
    wildcard_statements = [part["Sid"] for part in policy["Statement"] if "*" in part["Resource"]]
    assert wildcard_statements == ["DescribeSsmParameters"]


def test_validate_seeder_bootstrap_real_plane_allows_missing_trust_user_arn():
    # Auto-detection made the pin optional; it is only shape-checked when present.
    assert dp_secrets.validate_seeder_bootstrap(False, REAL_VALUE) == []


def test_validate_seeder_bootstrap_rejects_bad_user_arn():
    bad = {**REAL_VALUE, "SEEDER_TRUST_USER_ARN": "arn:aws:iam::123:user/short-account-id"}
    errors = "\n".join(dp_secrets.validate_seeder_bootstrap(False, bad))
    assert "SEEDER_TRUST_USER_ARN" in errors
    errors = "\n".join(
        dp_secrets.validate_seeder_bootstrap(
            True, {**EMULATOR_VALUE, "SEEDER_TRUST_USER_ARN": "arn:aws:iam::x:user/oops"}
        )
    )
    assert "SEEDER_TRUST_USER_ARN" in errors


def test_validate_seeder_bootstrap_emulator_ok_without_user_arn():
    assert dp_secrets.validate_seeder_bootstrap(True, EMULATOR_VALUE) == []


def test_seeder_bootstrap_flow_dry_run_prints_and_runs_nothing(monkeypatch, capsys):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator: (calls.append(list(command)), (0, "", ""))[1],
    )
    assert dp_secrets.seeder_bootstrap_flow(True, EMULATOR_VALUE, True) == 0
    assert calls == []  # dry run: nothing touches AWS
    out = capsys.readouterr().out
    assert "would run" in out and "iam create-role" in out


def test_seeder_bootstrap_flow_emulator_never_prompts(monkeypatch):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.seeder_bootstrap_flow(True, EMULATOR_VALUE, False) == 0


def test_seeder_bootstrap_flow_keeps_existing_role(monkeypatch, capsys):
    results = iter([
        (1, "", "An error occurred (EntityAlreadyExists) when calling the CreateRole operation"),
        (0, "", ""),
    ])
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: next(results))
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)
    assert dp_secrets.seeder_bootstrap_flow(True, EMULATOR_VALUE, False) == 0
    out = capsys.readouterr().out
    assert "already exists" in out and "session: 12h cap refreshed" in out
    assert "policy: seeder-policy attached" in out


def test_seeder_bootstrap_flow_warns_when_cap_refresh_fails(monkeypatch, capsys):
    results = iter([
        (1, "", "An error occurred (EntityAlreadyExists) when calling the CreateRole operation"),
        (299, "", "update boom"),
    ])
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: next(results))
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 0)
    assert dp_secrets.seeder_bootstrap_flow(True, EMULATOR_VALUE, False) == 0
    out = capsys.readouterr().out
    assert "warning: could not refresh the session cap" in out and "update boom" in out
    assert "aws iam update-role" in out and "policy: seeder-policy attached" in out


def test_seeder_bootstrap_flow_fails_loud_when_role_creation_fails(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (299, "", "boom"))
    assert dp_secrets.seeder_bootstrap_flow(True, EMULATOR_VALUE, False) == 1
    out = capsys.readouterr().out
    assert "create-role failed" in out and "boom" in out


def test_seeder_bootstrap_main_wiring(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    started = []
    monkeypatch.setattr(
        dp_secrets, "seeder_bootstrap_flow",
        lambda is_emulator, values, dry_run: started.append((is_emulator, dry_run)) or 0,
    )
    monkeypatch.setattr("sys.argv", ["secrets.py", "seeder-bootstrap", "--dry-run"])
    assert dp_secrets.main() == 0
    assert started == [(True, True)]


def test_build_tf_vars_json_escapes_seed_values():
    values = {**EMULATOR_VALUE, "OTEL_EXPORTER_OTLP_ENDPOINT": "http://host:4318/?trailing=a=b"}
    payload = json.loads(dp_secrets.build_tf_vars(values)["TF_VAR_ssm_parameters"])
    assert payload["OTEL_EXPORTER_OTLP_ENDPOINT"] == "http://host:4318/?trailing=a=b"


def test_build_tf_vars_maps_the_license_key_to_the_blob():
    values = {**VALID, "NEW_RELIC_LICENSE_KEY": "d" * 20}
    assert dp_secrets.build_tf_vars(values)["TF_VAR_new_relic_license_key"] == "d" * 20
    # Absent or empty: the blob key is not seeded, matching the SSM map rule.
    assert "TF_VAR_new_relic_license_key" not in dp_secrets.build_tf_vars(VALID)
    assert "TF_VAR_new_relic_license_key" not in dp_secrets.build_tf_vars({**VALID, "NEW_RELIC_LICENSE_KEY": ""})


def test_validate_seeder_bootstrap_real_plane_requires_state_bucket():
    values = {**VALID, "SEEDER_TRUST_USER_ARN": "arn:aws:iam::123456789012:user/kunalpisolkar"}
    errors = "\n".join(dp_secrets.validate_seeder_bootstrap(False, values))
    assert "TF_STATE_BUCKET" in errors


def test_drop_seeder_commands_detach_policy_before_deleting_role():
    commands = dp_secrets.drop_seeder_commands(True, EMULATOR_VALUE)
    assert len(commands) == 2
    assert "iam delete-role-policy --role-name detectai-document-parser-seeder --policy-name seeder-policy" in " ".join(commands[0])
    assert "iam delete-role --role-name detectai-document-parser-seeder" in " ".join(commands[1])
    assert "--endpoint-url http://localhost:4566" in " ".join(commands[0])


def test_drop_seeder_flow_dry_run_prints_and_runs_nothing(monkeypatch, capsys):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator: (calls.append(list(command)), (0, "", ""))[1],
    )
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: calls.append(list(command)) or 0)
    assert dp_secrets.drop_seeder_flow(True, EMULATOR_VALUE, True) == 0
    assert calls == []  # dry run: nothing touches AWS
    assert "would run" in capsys.readouterr().out


def test_drop_seeder_flow_acts_in_order_on_emulator(monkeypatch, capsys):
    run_calls: list[list[str]] = []
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))  # role exists
    monkeypatch.setattr(
        dp_secrets, "run_aws", lambda command, is_emulator: run_calls.append(list(command)) or 0
    )

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.drop_seeder_flow(True, EMULATOR_VALUE, False) == 0
    joined = [" ".join(call) for call in run_calls]
    assert "iam delete-role-policy" in joined[0]
    assert "iam delete-role" in joined[1]  # the role goes only after its policy
    out = capsys.readouterr().out
    assert "detached: seeder-policy" in out and "deleted: detectai-document-parser-seeder" in out


def test_drop_seeder_flow_skips_missing_role(monkeypatch, capsys):
    run_calls: list[list[str]] = []
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (255, "", ""))
    monkeypatch.setattr(
        dp_secrets, "run_aws", lambda command, is_emulator: run_calls.append(list(command)) or 0
    )
    assert dp_secrets.drop_seeder_flow(True, EMULATOR_VALUE, False) == 0
    assert run_calls == []  # nothing to drop: no mutations ran
    assert "nothing to drop" in capsys.readouterr().out


def test_drop_seeder_flow_real_plane_typed_barrier(monkeypatch, capsys):
    run_calls: list[list[str]] = []
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))  # role exists
    monkeypatch.setattr(
        dp_secrets, "run_aws", lambda command, is_emulator: run_calls.append(list(command)) or 0
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert dp_secrets.drop_seeder_flow(False, REAL_VALUE, False) == 1
    assert run_calls == []  # refusal keeps the role

    monkeypatch.setattr("builtins.input", lambda prompt="": "detectai-document-parser-seeder")
    assert dp_secrets.drop_seeder_flow(False, REAL_VALUE, False) == 0
    assert len(run_calls) == 2
    assert "cancelled" in capsys.readouterr().out


def test_drop_seeder_flow_fails_loud_when_policy_detach_fails(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))  # role exists
    monkeypatch.setattr(dp_secrets, "run_aws", lambda command, is_emulator: 1)
    assert dp_secrets.drop_seeder_flow(True, EMULATOR_VALUE, False) == 1
    assert "detach seeder-policy manually" in capsys.readouterr().out


def test_full_destroy_wipes_then_drops(monkeypatch, tmp_path):
    sequence: list[str] = []
    monkeypatch.setattr(
        dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: 0
    )
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    monkeypatch.setattr(dp_secrets, "run_aws_captured", lambda command, is_emulator: (0, "", ""))
    monkeypatch.setattr(dp_secrets, "purge_state", lambda is_emulator, values, session=None: sequence.append("purge") or 0)
    monkeypatch.setattr(
        dp_secrets, "drop_seeder_flow",
        lambda is_emulator, values, dry_run: sequence.append("drop") or 0,
    )
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "destroy", "--purge-state", "--drop-seeder"])
    assert dp_secrets.main() == 0
    assert sequence == ["purge", "drop"]  # bucket wiped before the identity is dropped


def test_main_rejects_drop_seeder_on_other_verbs(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "apply", "--drop-seeder"])
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.main()
    assert excinfo.value.code == 1


def test_build_tf_vars_recovery_window_per_plane():
    assert dp_secrets.build_tf_vars(EMULATOR_VALUE)["TF_VAR_secret_recovery_window"] == "0"
    # The emulator pins 0 whatever the knob says.
    pinned = dp_secrets.build_tf_vars({**EMULATOR_VALUE, "SECRET_RECOVERY_WINDOW": "30"})
    assert pinned["TF_VAR_secret_recovery_window"] == "0"

    real = dp_secrets.build_tf_vars(REAL_VALUE)
    assert real["TF_VAR_secret_recovery_window"] == "30"  # unset keeps the 30-day default
    zero = dp_secrets.build_tf_vars({**REAL_VALUE, "SECRET_RECOVERY_WINDOW": "0"})
    assert zero["TF_VAR_secret_recovery_window"] == "0"
    seven = dp_secrets.build_tf_vars({**REAL_VALUE, "SECRET_RECOVERY_WINDOW": "7"})
    assert seven["TF_VAR_secret_recovery_window"] == "7"


def test_validate_recovery_window_rules():
    for raw in ("0", "7", "15", "30"):
        assert dp_secrets.validate(False, {**REAL_VALUE, "SECRET_RECOVERY_WINDOW": raw}) == []
    for raw in ("3", "31", "abc", "-5", "1.5"):
        errors = "\n".join(
            dp_secrets.validate(False, {**REAL_VALUE, "SECRET_RECOVERY_WINDOW": raw})
        )
        assert "SECRET_RECOVERY_WINDOW" in errors and "fix:" in errors, raw
    sentences = "\n".join(
        dp_secrets.validate(False, {**REAL_VALUE, "SECRET_RECOVERY_WINDOW": "abc"})
    )
    assert "not a whole number" in sentences
    bounds = "\n".join(dp_secrets.validate(False, {**REAL_VALUE, "SECRET_RECOVERY_WINDOW": "31"}))
    assert "between 7 and 30" in bounds
    # On the emulator the knob is out of contract: ignored, never rejected.
    assert dp_secrets.validate(True, {**EMULATOR_VALUE, "SECRET_RECOVERY_WINDOW": "junk"}) == []


def test_plane_notes_recovery_window_messaging():
    ignored = "\n".join(
        dp_secrets.plane_notes({**EMULATOR_VALUE, "SECRET_RECOVERY_WINDOW": "30"}, "emulator (Floci)")
    )
    assert "ignored on the emulator plane" in ignored
    zero_real = "\n".join(
        dp_secrets.plane_notes({**REAL_VALUE, "SECRET_RECOVERY_WINDOW": "0"}, "real AWS")
    )
    assert "destroy deletes the secret immediately" in zero_real
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note
        for note in dp_secrets.plane_notes({**REAL_VALUE, "SECRET_RECOVERY_WINDOW": "30"}, "real AWS")
    )
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note for note in dp_secrets.plane_notes(REAL_VALUE, "real AWS")
    )


def test_summary_prints_the_recovery_window(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)

    env.write_text(
        "API_KEY=" + "a" * 20 + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\nSECRET_RECOVERY_WINDOW=7\n"
    )
    monkeypatch.setattr("sys.argv", ["secrets.py", "plan", "--dry-run"])
    assert dp_secrets.main() == 0
    assert "window: 7 day(s)" in capsys.readouterr().out

    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    assert dp_secrets.main() == 0
    assert "window: 0 day(s)" in capsys.readouterr().out

    env.write_text(
        "API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\nSECRET_RECOVERY_WINDOW=30\n"
    )
    assert dp_secrets.main() == 0
    out = capsys.readouterr().out
    assert "window: 0 day(s)" in out and "ignored on the emulator plane" in out


def test_dry_run_rejects_the_invalid_recovery_window(monkeypatch, tmp_path, capsys):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text(
        "API_KEY=" + "a" * 20
        + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\nSECRET_RECOVERY_WINDOW=31\n"
    )
    monkeypatch.setattr("sys.argv", ["secrets.py", "plan", "--dry-run"])
    assert dp_secrets.main() == 1
    assert "between 7 and 30" in capsys.readouterr().out


ASSUME_PAYLOAD = {
    "AssumedRoleUser": {"Arn": "arn:aws:sts::123456789012:assumed-role/detectai-document-parser-seeder/verbs"},
    "Credentials": {
        "AccessKeyId": "ASIA1",
        "SecretAccessKey": "s2",
        "SessionToken": "t3",
        "Expiration": "2025-01-01T02:00:00Z",
    },
}


def test_resolve_trust_principal_ladder():
    # Emulator: the structural placeholder unless pinned.
    assert dp_secrets.resolve_trust_principal(True, EMULATOR_VALUE) == "arn:aws:iam::000000000000:user/detectai-seeder"
    pinned = {**EMULATOR_VALUE, "SEEDER_TRUST_USER_ARN": USER_ARN}
    assert dp_secrets.resolve_trust_principal(True, pinned) == USER_ARN
    # Real plane: a pinned user ARN wins over whatever the environment reports.
    assert dp_secrets.resolve_trust_principal(False, {**REAL_VALUE, "SEEDER_TRUST_USER_ARN": USER_ARN}) == USER_ARN


def test_resolve_trust_principal_auto_detects_the_ambient_caller(monkeypatch):
    monkeypatch.setattr(dp_secrets, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    assert dp_secrets.resolve_trust_principal(False, REAL_VALUE) == USER_ARN


def test_resolve_trust_principal_strips_assumed_role_sessions(monkeypatch, capsys):
    monkeypatch.setattr(
        dp_secrets,
        "sts_caller_identity",
        lambda: ("123456789012", "arn:aws:sts::123456789012:assumed-role/OpsRole/kunal@corp"),
    )
    assert dp_secrets.resolve_trust_principal(False, REAL_VALUE) == "arn:aws:iam::123456789012:role/OpsRole"
    assert "assumed-role/OpsRole" in capsys.readouterr().out


def test_resolve_trust_principal_refuses_root(monkeypatch, capsys):
    monkeypatch.setattr(dp_secrets, "sts_caller_identity", lambda: ("123456789012", "arn:aws:iam::123456789012:root"))
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.resolve_trust_principal(False, REAL_VALUE)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "account root" in out and "SEEDER_TRUST_USER_ARN" in out


def test_resolve_trust_principal_refuses_its_own_session(monkeypatch, capsys):
    monkeypatch.setattr(
        dp_secrets,
        "sts_caller_identity",
        lambda: ("123456789012", "arn:aws:sts::123456789012:assumed-role/detectai-document-parser-seeder/verbs"),
    )
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.resolve_trust_principal(False, REAL_VALUE)
    assert excinfo.value.code == 1
    assert "already a detectai-document-parser-seeder session" in capsys.readouterr().out


def test_resolve_trust_principal_rejects_a_bad_override():
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.resolve_trust_principal(False, {**REAL_VALUE, "SEEDER_TRUST_USER_ARN": "oops"})
    assert excinfo.value.code == 1


def test_mfa_serial_derives_from_the_user_arn():
    assert dp_secrets.mfa_serial_for(USER_ARN, "") == "arn:aws:iam::123456789012:mfa/kunalpisolkar"
    assert dp_secrets.mfa_serial_for(USER_ARN, "arn:aws:iam::123456789012:mfa/legacy") == (
        "arn:aws:iam::123456789012:mfa/legacy"
    )
    assert dp_secrets.mfa_serial_for("arn:aws:iam::123456789012:role/OpsRole", "") is None


def test_seeder_role_arn_and_principal_account_round_trip():
    assert dp_secrets.seeder_role_arn("123456789012") == ROLE_ARN
    assert dp_secrets.iam_account_id("arn:aws:iam::123456789012:role/OpsRole") == "123456789012"
    assert dp_secrets.role_arn_of_session("arn:aws:sts::123456789012:assumed-role/OpsRole/kunal@corp") == (
        "arn:aws:iam::123456789012:role/OpsRole"
    )
    # A role path survives the session-suffix strip.
    assert dp_secrets.role_arn_of_session("arn:aws:sts::123456789012:assumed-role/Team/OpsRole/verbs") == (
        "arn:aws:iam::123456789012:role/Team/OpsRole"
    )


def test_cached_session_reads_only_fresh_matching_triples(monkeypatch, tmp_path):
    cache = tmp_path / "session.json"
    monkeypatch.setattr(dp_secrets, "SESSION_CACHE_FILE", cache)
    monkeypatch.setattr(dp_secrets, "_utcnow", lambda: datetime(2025, 1, 1, tzinfo=UTC))
    payload = {
        "role_arn": ROLE_ARN,
        "access_key_id": "ASIA1",
        "secret_access_key": "s",
        "session_token": "t",
        "expires_at": "2025-01-01T01:00:00Z",
    }

    cache.write_text(json.dumps(payload))
    assert dp_secrets.cached_session(ROLE_ARN) == payload

    payload["expires_at"] = "2025-01-01T00:05:00Z"  # inside the renewal margin
    cache.write_text(json.dumps(payload))
    assert dp_secrets.cached_session(ROLE_ARN) is None

    payload["expires_at"] = "2025-01-01T01:00:00Z"  # a different role reads as no cache
    cache.write_text(json.dumps(payload))
    assert dp_secrets.cached_session("arn:aws:iam::999999999999:role/nope") is None

    cache.write_text("not json")
    assert dp_secrets.cached_session(ROLE_ARN) is None


def test_save_cached_session_writes_owner_only_json(monkeypatch, tmp_path):
    session = {
        "role_arn": ROLE_ARN,
        "access_key_id": "ASIA1",
        "secret_access_key": "s",
        "session_token": "t",
        "expires_at": "2025-01-01T02:00:00Z",
    }
    monkeypatch.setattr(dp_secrets, "SESSION_CACHE_FILE", tmp_path / "session.json")
    dp_secrets.save_cached_session(session)
    assert json.loads((tmp_path / "session.json").read_text()) == session
    assert (tmp_path / "session.json").stat().st_mode & 0o777 == 0o600


def test_assume_seeder_session_promotes_with_the_prompted_code(monkeypatch, tmp_path):
    commands = []
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator, session=None: commands.append(list(command)) or (0, json.dumps(ASSUME_PAYLOAD), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "123456")
    session = dp_secrets.assume_seeder_session(ROLE_ARN, "arn:aws:iam::123456789012:mfa/kunalpisolkar")
    joined = " ".join(commands[0])
    assert "--token-code 123456" in joined and "--duration-seconds 43200" in joined
    assert "--role-session-name document-parser-" in joined
    assert "--endpoint-url" not in joined
    assert session["access_key_id"] == "ASIA1" and session["role_arn"] == ROLE_ARN


def test_assume_seeder_session_rejects_a_bad_code(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "12ab56")
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.assume_seeder_session(ROLE_ARN, "serial")
    assert excinfo.value.code == 1
    assert "6-digit" in capsys.readouterr().out


def test_assume_seeder_session_rejects_identity_that_is_not_the_seeder(monkeypatch, capsys):
    alien = {
        "AssumedRoleUser": {"Arn": "arn:aws:sts::123456789012:assumed-role/Other/x"},
        "Credentials": ASSUME_PAYLOAD["Credentials"],
    }
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps(alien), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "123456")
    with pytest.raises(SystemExit):
        dp_secrets.assume_seeder_session(ROLE_ARN, "serial")
    assert "not the seeder role" in capsys.readouterr().out


def test_assume_seeder_session_fails_loud_on_aws_errors(monkeypatch, capsys):
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator, session=None: (255, "", "InvalidClientTokenException boom"),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "999999")
    with pytest.raises(SystemExit):
        dp_secrets.assume_seeder_session(ROLE_ARN, "serial")
    out = capsys.readouterr().out
    assert "could not assume" in out and "boom" in out


def test_resolve_carrier_session_stays_session_free_off_the_real_plane(monkeypatch):
    def no_aws(*args, **kwargs):
        raise AssertionError("no AWS on the emulator or dry runs")

    monkeypatch.setattr(dp_secrets, "sts_caller_identity", no_aws)

    def no_prompt(prompt=""):
        raise AssertionError("no MFA prompt on the emulator or dry runs")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert dp_secrets.resolve_carrier_session(True, EMULATOR_VALUE, False) is None
    assert dp_secrets.resolve_carrier_session(False, REAL_VALUE, True) is None


def test_resolve_carrier_session_reuses_the_cached_triplet(monkeypatch, tmp_path):
    cache = tmp_path / "session.json"
    monkeypatch.setattr(dp_secrets, "SESSION_CACHE_FILE", cache)
    monkeypatch.setattr(dp_secrets, "_utcnow", lambda: datetime(2025, 1, 1, tzinfo=UTC))
    cached = {
        "role_arn": ROLE_ARN,
        "access_key_id": "ASIA1",
        "secret_access_key": "s",
        "session_token": "t",
        "expires_at": "2025-01-01T01:00:00Z",
    }
    cache.write_text(json.dumps(cached))
    monkeypatch.setattr(dp_secrets, "sts_caller_identity", lambda: ("123456789012", USER_ARN))

    def no_assume(command, is_emulator, session=None):
        raise AssertionError("a cached session must not re-assume")

    monkeypatch.setattr(dp_secrets, "run_aws_captured", no_assume)
    assert dp_secrets.resolve_carrier_session(False, REAL_VALUE, False) == cached


def test_resolve_carrier_session_promotes_and_caches_when_fresh(monkeypatch, tmp_path):
    cache = tmp_path / "session.json"
    monkeypatch.setattr(dp_secrets, "SESSION_CACHE_FILE", cache)
    monkeypatch.setattr(dp_secrets, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    monkeypatch.setattr(
        dp_secrets, "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps(ASSUME_PAYLOAD), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "123456")
    session = dp_secrets.resolve_carrier_session(False, REAL_VALUE, False)
    assert session["session_token"] == "t3"
    assert json.loads(cache.read_text())["role_arn"] == ROLE_ARN


def test_resolve_carrier_session_reports_an_undetectable_serial(monkeypatch, capsys):
    monkeypatch.setattr(
        dp_secrets, "sts_caller_identity",
        lambda: ("123456789012", "arn:aws:iam::123456789012:role/OpsRole"),
    )
    with pytest.raises(SystemExit) as excinfo:
        dp_secrets.resolve_carrier_session(False, REAL_VALUE, False)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "cannot derive" in out and "SEEDER_MFA_SERIAL" in out


def test_aws_env_injects_the_session_triplet_and_drops_the_profile(monkeypatch):
    monkeypatch.setenv("AWS_PROFILE", "floci")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "stale-token")
    session = {"access_key_id": "A", "secret_access_key": "B", "session_token": "C"}
    env = dp_secrets.aws_env(False, session)
    assert env["AWS_ACCESS_KEY_ID"] == "A" and env["AWS_SESSION_TOKEN"] == "C"
    assert "AWS_PROFILE" not in env


def test_aws_env_keeps_emulator_fakes_and_leaves_ambient_untouched(monkeypatch):
    monkeypatch.setenv("AWS_PROFILE", "floci")
    emu = dp_secrets.aws_env(True)
    assert "AWS_PROFILE" not in emu and emu["AWS_ACCESS_KEY_ID"] == "test"

    monkeypatch.delenv("AWS_PROFILE")
    assert dp_secrets.aws_env(False, None) == dict(os.environ)


def test_real_apply_rides_the_seeder_session_triplet(monkeypatch, tmp_path, capsys):
    overlays = []

    def fake_run_terraform(args, tf_vars, env_overlay=None):
        overlays.append(env_overlay)
        return 0

    monkeypatch.setattr(dp_secrets, "run_terraform", fake_run_terraform)
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    monkeypatch.setattr(dp_secrets, "ensure_state_bucket", lambda is_emulator, values: 0)
    monkeypatch.setattr(dp_secrets, "resolve_carrier_session", fake_carrier_session)
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "plan"])
    assert dp_secrets.main() == 0
    for overlay in overlays:
        assert overlay["AWS_ACCESS_KEY_ID"] == "ASIAFAKEID000000"
        assert overlay["AWS_SESSION_TOKEN"] == "fake-token"
    out = capsys.readouterr().out
    assert "role session (detectai-document-parser-seeder" in out


def test_emulator_banner_states_the_fake_creds(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(dp_secrets, "run_terraform", lambda args, tf_vars, env_overlay=None: 0)
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    monkeypatch.setattr(dp_secrets, "ensure_state_bucket", lambda is_emulator, values: 0)
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "plan"])
    assert dp_secrets.main() == 0
    assert "carrier: env creds (test/test, profile stripped)" in capsys.readouterr().out


def test_dry_run_banner_defers_the_carrier(monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(dp_secrets, "write_backend_hcl", lambda hcl: tmp_path / "backend.hcl")
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nTF_STATE_BUCKET=detectai-tfstate-sandbox\n")
    monkeypatch.setattr("sys.argv", ["secrets.py", "plan", "--dry-run"])
    assert dp_secrets.main() == 0
    out = capsys.readouterr().out
    assert "seeder role session (promoted when the command runs)" in out


def test_session_clear_removes_and_reports(monkeypatch, tmp_path, capsys):
    cache = tmp_path / "session.json"
    monkeypatch.setattr(dp_secrets, "SESSION_CACHE_FILE", cache)
    cache.write_text("{}")
    monkeypatch.setattr("sys.argv", ["secrets.py", "session-clear"])
    assert dp_secrets.main() == 0  # works without infra/.env (the verb needs no config)
    out = capsys.readouterr().out
    assert "removed:" in out and "session.json" in out

    monkeypatch.setattr("sys.argv", ["secrets.py", "session-clear"])
    assert dp_secrets.main() == 0
    assert "nothing to clear" in capsys.readouterr().out


def test_seeder_drop_command_runs_the_drop_flow(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    started = []
    monkeypatch.setattr(
        dp_secrets, "drop_seeder_flow",
        lambda is_emulator, values, dry_run: started.append((is_emulator, dry_run)) or 0,
    )
    monkeypatch.setattr("sys.argv", ["secrets.py", "seeder-drop", "--dry-run"])
    assert dp_secrets.main() == 0
    assert started == [(True, True)]


def test_bootstrap_carries_the_resolved_session(monkeypatch, tmp_path):
    env = tmp_path / ".env"
    monkeypatch.setattr(dp_secrets, "ENV_FILE", env)
    env.write_text("API_KEY=" + "a" * 20 + "\nEMULATOR_ENDPOINT=http://localhost:4566\n")
    captured = []
    monkeypatch.setattr(
        dp_secrets, "bootstrap_state",
        lambda is_emulator, values, dry_run, session=None: captured.append((is_emulator, dry_run, session)) or 0,
    )
    monkeypatch.setattr("sys.argv", ["secrets.py", "bootstrap", "--dry-run"])
    assert dp_secrets.main() == 0
    assert captured == [(True, True, None)]


def test_cli_main_returns_130_on_keyboard_interrupt(monkeypatch, capsys):
    def interrupted():
        raise KeyboardInterrupt

    monkeypatch.setattr(dp_secrets, "main", interrupted)
    assert dp_secrets.cli_main() == 130
    out = capsys.readouterr().out
    assert "interrupted" in out and "traceback" not in out.lower()


def test_cli_main_reads_eof_at_a_prompt_as_cancellation(monkeypatch, capsys):
    def eof():
        raise EOFError

    monkeypatch.setattr(dp_secrets, "main", eof)
    assert dp_secrets.cli_main() == 1
    out = capsys.readouterr().out
    assert "cancelled" in out
