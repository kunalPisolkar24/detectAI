"""Terraform composition and the bucket verbs: TF vars, backend HCL, bootstrap, purge."""

from __future__ import annotations

import json

import pytest

from conftest import DP, EMULATOR_ENV, REAL_ENV
from secretsctl import stack

pytestmark = pytest.mark.unit


FLOCI_BUCKET = "detectai-document-parser-tfstate-000000000000"
REAL_ACCOUNT = "123456789012"
REAL_BUCKET = f"detectai-document-parser-tfstate-{REAL_ACCOUNT}"


def test_build_tf_vars_maps_both_planes():
    emulator = stack.build_tf_vars(DP, EMULATOR_ENV, True)
    assert emulator["TF_VAR_emulator_endpoint"] == "http://localhost:4566"
    assert emulator["TF_VAR_secret_recovery_window"] == "0"
    assert json.loads(emulator["TF_VAR_blob"]) == {"API_KEY": "a" * 20}

    real = stack.build_tf_vars(DP, REAL_ENV, False)
    assert "TF_VAR_emulator_endpoint" not in real
    assert real["TF_VAR_secret_recovery_window"] == "30"
    assert real["TF_VAR_aws_region"] == "ap-southeast-2"


def test_build_tf_vars_region_override_and_no_pinned_secret_name():
    mapped = stack.build_tf_vars(DP, {**EMULATOR_ENV, "AWS_REGION": "us-east-1"}, True)
    assert mapped["TF_VAR_aws_region"] == "us-east-1"
    assert "TF_VAR_secrets_name" not in mapped  # the contract name is terraform's own default


def _field(hcl: str, key: str) -> str:
    import re

    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*(\S+)", hcl, re.MULTILINE)
    assert match is not None, f"{key} missing in: {hcl!r}"
    return match.group(1).strip('"')


def test_build_backend_hcl_emulator():
    hcl = stack.build_backend_hcl(DP, EMULATOR_ENV, True, "000000000000")
    assert _field(hcl, "bucket") == FLOCI_BUCKET
    assert _field(hcl, "key").endswith("/floci/terraform.tfstate")
    assert _field(hcl, "encrypt") == "false"
    assert _field(hcl, "skip_credentials_validation") == "true"
    assert _field(hcl, "use_path_style") == "true"
    assert 's3 = "http://localhost:4566"' in hcl
    assert "use_lockfile" not in hcl


def test_build_backend_hcl_real_aws():
    hcl = stack.build_backend_hcl(DP, REAL_ENV, False, REAL_ACCOUNT)
    assert _field(hcl, "bucket") == REAL_BUCKET
    assert _field(hcl, "key") == "document-parser/terraform.tfstate"
    assert _field(hcl, "encrypt") == "true"
    assert _field(hcl, "use_lockfile") == "true"
    assert "endpoints" not in hcl
    assert "skip_credentials_validation" not in hcl


def test_build_backend_hcl_region_resolution():
    assert (
        _field(stack.build_backend_hcl(DP, EMULATOR_ENV, True, "000000000000"), "region")
        == "ap-southeast-2"
    )
    custom = {**REAL_ENV, "AWS_REGION": "us-east-1"}
    assert _field(stack.build_backend_hcl(DP, custom, False, REAL_ACCOUNT), "region") == "us-east-1"


def test_build_backend_hcl_ignores_a_stray_tf_state_bucket_line():
    stray = {**EMULATOR_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}
    hcl = stack.build_backend_hcl(DP, stray, True, "000000000000")
    assert _field(hcl, "bucket") == FLOCI_BUCKET  # always derived, never hand-passed


def test_bootstrap_commands_emulator():
    commands = stack.bootstrap_commands(DP, EMULATOR_ENV, True, "000000000000")
    assert len(commands) == 3  # head-bucket, mb, put-bucket-versioning — same shape as real AWS
    assert commands[0][-3:] == ["head-bucket", "--bucket", FLOCI_BUCKET]
    assert "--endpoint-url http://localhost:4566" in " ".join(commands[0])
    assert commands[1][-1] == f"s3://{FLOCI_BUCKET}"
    assert " ".join(commands[2]) == (
        f"aws --region ap-southeast-2 --endpoint-url http://localhost:4566 "
        f"s3api put-bucket-versioning --bucket {FLOCI_BUCKET} "
        "--versioning-configuration Status=Enabled"
    )


def test_bootstrap_commands_real_aws():
    commands = stack.bootstrap_commands(DP, REAL_ENV, False, REAL_ACCOUNT)
    assert len(commands) == 3  # head-bucket, mb, put-bucket-versioning
    assert commands[0][-3:] == ["head-bucket", "--bucket", REAL_BUCKET]
    assert "endpoint-url" not in commands[0]
    assert commands[1][-1] == f"s3://{REAL_BUCKET}"
    assert " ".join(commands[2]) == (
        "aws --region ap-southeast-2 s3api put-bucket-versioning "
        f"--bucket {REAL_BUCKET} --versioning-configuration Status=Enabled"
    )


def test_force_delete_command_pins_the_contract_name():
    command = " ".join(stack.force_delete_command(DP, REAL_ENV, False))
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

    monkeypatch.setattr(stack, "run_aws", fake_run_aws)

    def fake_captured(command: list[str], is_emulator: bool, session=None) -> tuple[int, str, str]:
        calls.append(list(command))
        return 0, json.dumps(listing), ""

    monkeypatch.setattr(stack, "run_aws_captured", fake_captured)
    assert stack.purge_state(DP, REAL_ENV, False, REAL_ACCOUNT) == 0

    joined = [" ".join(call) for call in calls]
    assert "head-bucket" in joined[0]  # the purge walks over existing buckets only
    assert "list-object-versions" in joined[1]
    assert (
        len([call for call in joined if "delete-object" in call]) == 3
    )  # two versions + one marker
    assert (
        "--version-id v1" in joined[2]
        and "--version-id v2" in joined[3]
        and "--version-id d1" in joined[4]
    )
    assert joined[-1].endswith(f"delete-bucket --bucket {REAL_BUCKET}")
    assert all(REAL_BUCKET in call for call in joined)
    assert f"deleted: {REAL_BUCKET}" in capsys.readouterr().out


def test_purge_state_skips_missing_bucket(monkeypatch, capsys):
    def fake_run_aws(command: list[str], is_emulator: bool, session=None) -> int:
        return 255 if "head-bucket" in command else 0

    monkeypatch.setattr(stack, "run_aws", fake_run_aws)
    assert stack.purge_state(DP, REAL_ENV, False, REAL_ACCOUNT) == 0
    assert "already gone; nothing to purge" in capsys.readouterr().out


def test_confirm_purge_typed_barrier_on_real_plane(monkeypatch, capsys):
    monkeypatch.setattr(
        stack, "run_aws", lambda command, is_emulator, session=None: 0
    )  # bucket exists
    listing = [
        ("document-parser/terraform.tfstate", "v1"),
        ("chats/terraform.tfstate", "v2"),
    ]
    monkeypatch.setattr(
        stack,
        "list_bucket_versions",
        lambda declaration, values, is_emulator, account, session=None: listing,
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert stack.confirm_purge(DP, REAL_ENV, False, REAL_ACCOUNT) is False
    out = capsys.readouterr().out
    assert "purge will wipe 2 object version(s)" in out
    assert "outside document-parser/" in out  # sibling stacks in the shared sandbox are called out
    assert "cancelled: nothing was destroyed" in out

    monkeypatch.setattr(
        stack,
        "list_bucket_versions",
        lambda declaration, values, is_emulator, account, session=None: [],
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": REAL_BUCKET)
    assert stack.confirm_purge(DP, REAL_ENV, False, REAL_ACCOUNT) is True


def test_confirm_purge_emulator_never_prompts(monkeypatch):
    monkeypatch.setattr(
        stack, "run_aws", lambda command, is_emulator, session=None: 0
    )  # bucket exists
    monkeypatch.setattr(
        stack,
        "list_bucket_versions",
        lambda declaration, values, is_emulator, account, session=None: [],
    )

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    assert stack.confirm_purge(DP, EMULATOR_ENV, True, "000000000000") is True


def test_confirm_purge_bucket_missing_is_a_noop(monkeypatch, capsys):
    monkeypatch.setattr(
        stack, "run_aws", lambda command, is_emulator, session=None: 255
    )  # head-bucket 404
    assert stack.confirm_purge(DP, REAL_ENV, False, REAL_ACCOUNT) is True
    assert "does not exist; the purge step will be a no-op" in capsys.readouterr().out


def test_ensure_state_bucket_self_heals_missing_emulator_bucket(monkeypatch, capsys):
    monkeypatch.setattr(
        stack,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (255, "", "NoSuchBucket"),
    )
    created = []
    monkeypatch.setattr(
        stack,
        "bootstrap_state",
        lambda declaration, values, is_emulator, dry_run, account, session=None: created.append(
            (account, session)
        )
        or 0,
    )
    carrier = {
        "role_arn": "r",
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
    }
    assert stack.ensure_state_bucket(DP, EMULATOR_ENV, True, "000000000000", carrier) == 0
    assert created == [("000000000000", carrier)]  # a real, acting creation on the carrier session
    assert f"{FLOCI_BUCKET} is missing; creating it" in capsys.readouterr().out


def test_ensure_state_bucket_skips_existing_bucket_and_real_plane(monkeypatch, capsys):
    created = []
    monkeypatch.setattr(stack, "bootstrap_state", lambda *arguments: created.append(True) or 1)

    monkeypatch.setattr(
        stack, "run_aws_captured", lambda command, is_emulator, session=None: (0, "", "")
    )
    assert stack.ensure_state_bucket(DP, EMULATOR_ENV, True, "000000000000") == 0  # bucket exists

    monkeypatch.setattr(
        stack,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (255, "", "NoSuchBucket"),
    )
    assert stack.ensure_state_bucket(DP, REAL_ENV, False, REAL_ACCOUNT) == 0  # never auto-creates
    assert created == []
    assert capsys.readouterr().out == ""


def test_bootstrap_state_dry_run_prints_and_runs_nothing(monkeypatch, capsys):
    def fail(*arguments, **rest):
        raise AssertionError("dry run must not touch AWS")

    monkeypatch.setattr(stack, "run_aws", fail)
    assert stack.bootstrap_state(DP, EMULATOR_ENV, True, True, "000000000000") == 0
    out = capsys.readouterr().out
    assert out.count("would run:") == 3 and "(dry run: no AWS writes)" in out


def test_bootstrap_state_creates_and_reuses(monkeypatch, capsys):
    calls: list[list[str]] = []
    monkeypatch.setattr(
        stack,
        "run_aws",
        lambda command, is_emulator, session=None: calls.append(list(command))
        or (255 if "head-bucket" in command else 0),
    )
    assert stack.bootstrap_state(DP, REAL_ENV, False, False, REAL_ACCOUNT) == 0
    created_output = capsys.readouterr().out
    assert f"created: {REAL_BUCKET}" in created_output
    assert "versioning: Enabled" in created_output

    calls.clear()
    monkeypatch.setattr(stack, "run_aws", lambda command, is_emulator, session=None: 0)
    assert stack.bootstrap_state(DP, REAL_ENV, False, False, REAL_ACCOUNT) == 0
    assert "already exists" in capsys.readouterr().out


def test_bootstrap_state_reports_an_unreachable_emulator(monkeypatch, capsys):
    calls: list[list[str]] = []

    def fake_run_aws(command: list[str], is_emulator: bool, session=None) -> int:
        calls.append(list(command))
        return 255

    monkeypatch.setattr(stack, "run_aws", fake_run_aws)
    assert stack.bootstrap_state(DP, EMULATOR_ENV, True, False, "000000000000") == 1
    out = capsys.readouterr().out
    assert "docker start floci" in out


def test_build_tf_vars_seeds_present_config_keys():
    values = {**EMULATOR_ENV, "OTEL_TRACE_SAMPLE_RATIO": "0.5", "MAX_PDF_PAGES": "1200"}
    mapped = stack.build_tf_vars(DP, values, True)
    assert json.loads(mapped["TF_VAR_ssm_parameters"]) == {
        "OTEL_TRACE_SAMPLE_RATIO": "0.5",
        "MAX_PDF_PAGES": "1200",
    }


def test_build_tf_vars_skips_absent_and_empty_config_keys():
    assert "TF_VAR_ssm_parameters" not in stack.build_tf_vars(DP, EMULATOR_ENV, True)
    assert "TF_VAR_ssm_parameters" not in stack.build_tf_vars(
        DP, {**EMULATOR_ENV, "OTEL_TRACE_SAMPLE_RATIO": ""}, True
    )


def test_build_tf_vars_ignores_unlisted_keys():
    values = {**EMULATOR_ENV, "PORT": "8000", "RANDOM_THING": "v"}
    payload = json.loads(stack.build_tf_vars(DP, values, True).get("TF_VAR_ssm_parameters", "{}"))
    assert "PORT" not in payload and "RANDOM_THING" not in payload


def test_build_tf_vars_json_escapes_seed_values():
    values = {**EMULATOR_ENV, "OTEL_EXPORTER_OTLP_ENDPOINT": "http://host:4318/?trailing=a=b"}
    payload = json.loads(stack.build_tf_vars(DP, values, True)["TF_VAR_ssm_parameters"])
    assert payload["OTEL_EXPORTER_OTLP_ENDPOINT"] == "http://host:4318/?trailing=a=b"


def test_build_tf_vars_maps_the_license_key_to_the_blob():
    values = {**{"API_KEY": "a" * 20}, "NEW_RELIC_LICENSE_KEY": "d" * 20}
    blob = json.loads(stack.build_tf_vars(DP, values, False)["TF_VAR_blob"])
    assert blob == {"API_KEY": "a" * 20, "NEW_RELIC_LICENSE_KEY": "d" * 20}
    # Absent or empty: the blob key is not seeded, matching the SSM map rule.
    bare = {"API_KEY": "a" * 20}
    assert json.loads(stack.build_tf_vars(DP, bare, False)["TF_VAR_blob"]) == {"API_KEY": "a" * 20}
    blanked = {**bare, "NEW_RELIC_LICENSE_KEY": ""}
    assert "NEW_RELIC_LICENSE_KEY" not in json.loads(
        stack.build_tf_vars(DP, blanked, False)["TF_VAR_blob"]
    )


def test_build_tf_vars_recovery_window_per_plane():
    assert stack.build_tf_vars(DP, EMULATOR_ENV, True)["TF_VAR_secret_recovery_window"] == "0"
    # The emulator pins 0 whatever the knob says.
    pinned = stack.build_tf_vars(DP, {**EMULATOR_ENV, "SECRET_RECOVERY_WINDOW": "30"}, True)
    assert pinned["TF_VAR_secret_recovery_window"] == "0"

    assert (
        stack.build_tf_vars(DP, REAL_ENV, False)["TF_VAR_secret_recovery_window"] == "30"
    )  # unset keeps the default
    zero = stack.build_tf_vars(DP, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "0"}, False)
    assert zero["TF_VAR_secret_recovery_window"] == "0"
    seven = stack.build_tf_vars(DP, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "7"}, False)
    assert seven["TF_VAR_secret_recovery_window"] == "7"
