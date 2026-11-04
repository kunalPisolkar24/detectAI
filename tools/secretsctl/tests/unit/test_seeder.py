"""Seeder carrier: trust ladder, MFA serials, cached sessions, bootstrap and drop flows."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from conftest import DP, EMULATOR_ENV, REAL_ENV, ROLE_ARN, USER_ARN
from secretsctl import seeder

pytestmark = pytest.mark.unit


def test_role_session_name_sanitizes_the_user(monkeypatch):
    monkeypatch.setattr(seeder.getpass, "getuser", lambda: "kunal p")
    assert seeder.role_session_name(DP) == "document-parser-kunal.p"


def test_seeder_role_arn_and_session_mark():
    assert seeder.seeder_role_arn(DP, "123456789012") == ROLE_ARN
    assert seeder.seeder_role_session_mark(DP) == "assumed-role/detectai-document-parser-seeder/"


def test_role_arn_of_session_strips_the_session_and_keeps_the_path():
    flat = "arn:aws:sts::123456789012:assumed-role/OpsRole/sess"
    assert seeder.role_arn_of_session(flat) == "arn:aws:iam::123456789012:role/OpsRole"
    pathed = "arn:aws:sts::123456789012:assumed-role/team/OpsRole/sess"
    assert seeder.role_arn_of_session(pathed) == "arn:aws:iam::123456789012:role/team/OpsRole"


def test_iam_account_id_reads_the_account_and_rejects_non_iam_principals():
    assert seeder.iam_account_id(USER_ARN) == "123456789012"
    with pytest.raises(SystemExit) as excinfo:
        seeder.iam_account_id("arn:aws:s3:::some-bucket")
    assert excinfo.value.code == 1


def test_resolve_trust_principal_emulator_placeholder_derives_from_the_role():
    principal = seeder.resolve_trust_principal(DP, EMULATOR_ENV, True)
    assert principal == f"arn:aws:iam::000000000000:user/{DP.seeder_role_name}"


def test_resolve_trust_principal_emulator_honors_the_override():
    values = {**EMULATOR_ENV, "SEEDER_TRUST_USER_ARN": USER_ARN}
    assert seeder.resolve_trust_principal(DP, values, True) == USER_ARN


def test_resolve_trust_principal_real_uses_the_ambient_user(monkeypatch):
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    assert seeder.resolve_trust_principal(DP, REAL_ENV, False) == USER_ARN


def test_resolve_trust_principal_promotes_role_sessions_to_their_base_role(monkeypatch, capsys):
    session_arn = "arn:aws:sts::123456789012:assumed-role/OpsRole/sess"
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", session_arn))
    principal = seeder.resolve_trust_principal(DP, REAL_ENV, False)
    assert principal == "arn:aws:iam::123456789012:role/OpsRole"
    assert "its base role becomes the trust principal" in capsys.readouterr().out


def test_resolve_trust_principal_rejects_root(monkeypatch):
    monkeypatch.setattr(
        seeder, "sts_caller_identity", lambda: ("123456789012", "arn:aws:iam::123456789012:root")
    )
    with pytest.raises(SystemExit) as excinfo:
        seeder.resolve_trust_principal(DP, REAL_ENV, False)
    assert excinfo.value.code == 1


def test_resolve_trust_principal_rejects_an_existing_seeder_session(monkeypatch, capsys):
    session_arn = f"arn:aws:sts::123456789012:assumed-role/{DP.seeder_role_name}/sess"
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", session_arn))
    with pytest.raises(SystemExit) as excinfo:
        seeder.resolve_trust_principal(DP, REAL_ENV, False)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "already a detectai-document-parser-seeder session" in out
    assert "session-clear" in out


def test_resolve_trust_principal_validates_the_override_shape():
    values = {**REAL_ENV, "SEEDER_TRUST_USER_ARN": "arn:aws:iam::123456789012:role/OpsRole"}
    with pytest.raises(SystemExit) as excinfo:
        seeder.resolve_trust_principal(DP, values, False)
    assert excinfo.value.code == 1


def test_mfa_serial_ladder():
    assert seeder.mfa_serial_for(USER_ARN, "") == "arn:aws:iam::123456789012:mfa/kunalpisolkar"
    override = "arn:aws:iam::123456789012:mfa/custom-device"
    assert seeder.mfa_serial_for(USER_ARN, override) == override
    assert seeder.mfa_serial_for("arn:aws:iam::123456789012:role/OpsRole", "") is None


def test_validate_seeder_bootstrap_scope(dp):
    assert seeder.validate_seeder_bootstrap(DP, EMULATOR_ENV, True) == []
    bad_arn = "\n".join(
        seeder.validate_seeder_bootstrap(DP, {**REAL_ENV, "SEEDER_TRUST_USER_ARN": "nope"}, False)
    )
    assert "SEEDER_TRUST_USER_ARN" in bad_arn
    missing_bucket = "\n".join(seeder.validate_seeder_bootstrap(DP, {"API_KEY": "a" * 20}, False))
    assert "TF_STATE_BUCKET" in missing_bucket
    bad_region = "\n".join(
        seeder.validate_seeder_bootstrap(DP, {**EMULATOR_ENV, "AWS_REGION": "Mars-1"}, True)
    )
    assert "AWS_REGION" in bad_region


def test_validate_seeder_role_scope():
    assert seeder.validate_seeder_role(DP, EMULATOR_ENV, True) == []
    errors = "\n".join(seeder.validate_seeder_role(DP, {"AWS_REGION": "Mars-1"}, True))
    assert "AWS_REGION" in errors


def test_trust_document_requires_mfa():
    document = seeder.seeder_trust_document(USER_ARN)
    statement = document["Statement"][0]
    assert statement["Principal"] == {"AWS": USER_ARN}
    assert statement["Action"] == "sts:AssumeRole"
    assert statement["Condition"] == {"Bool": {"aws:MultiFactorAuthPresent": "true"}}


def test_policy_document_scopes_every_service_pinned_arn():
    policy = seeder.seeder_policy_document(DP, EMULATOR_ENV, True, USER_ARN)
    sids = [statement["Sid"] for statement in policy["Statement"]]
    assert sids == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageServiceSecret",
        "ManageServiceConfig",
        "DescribeSsmParameters",
    ]
    bucket, objects, secret, ssm, describe = policy["Statement"]
    assert bucket["Resource"] == ["arn:aws:s3:::detectai-docparser-tfstate"]
    assert objects["Resource"] == ["arn:aws:s3:::detectai-docparser-tfstate/*"]
    assert secret["Resource"] == [
        "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:detectai/document-parser/secrets-*"
    ]
    assert ssm["Resource"] == [
        "arn:aws:ssm:ap-southeast-2:123456789012:parameter/detectai/document-parser/*"
    ]
    assert describe["Resource"] == ["*"]


def test_bootstrap_commands_shape():
    commands = seeder.seeder_bootstrap_commands(DP, EMULATOR_ENV, True)
    assert len(commands) == 3
    create = commands[0]
    iam = create.index("iam")
    assert create[iam : iam + 4] == ["iam", "create-role", "--role-name", DP.seeder_role_name]
    assert "--max-session-duration" in create and "43200" in create
    trust = json.loads(create[create.index("--assume-role-policy-document") + 1])
    placeholder = seeder.resolve_trust_principal(DP, EMULATOR_ENV, True)
    assert trust == seeder.seeder_trust_document(placeholder)
    update = commands[1]
    assert update[update.index("iam") : update.index("iam") + 2] == ["iam", "update-role"]
    put_policy = commands[2]
    iam = put_policy.index("iam")
    assert put_policy[iam : iam + 4] == [
        "iam",
        "put-role-policy",
        "--role-name",
        DP.seeder_role_name,
    ]
    assert "--policy-name" in put_policy and "seeder-policy" in put_policy
    policy = json.loads(put_policy[put_policy.index("--policy-document") + 1])
    assert policy["Statement"][0]["Sid"] == "RunTerraformStateBucket"


def test_confirm_seeder_bootstrap_barrier(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda prompt="": DP.seeder_role_name)
    assert seeder.confirm_seeder_bootstrap(DP, USER_ARN) is True
    monkeypatch.setattr("builtins.input", lambda prompt="": "no")
    assert seeder.confirm_seeder_bootstrap(DP, USER_ARN) is False


def test_bootstrap_flow_dry_run_prints_three_commands(monkeypatch, capsys):
    def boom(*arguments, **rest):
        raise AssertionError("dry run must not touch AWS")

    monkeypatch.setattr(seeder, "run_aws", boom)
    monkeypatch.setattr(seeder, "run_aws_captured", boom)
    assert seeder.seeder_bootstrap_flow(DP, EMULATOR_ENV, True, True) == 0
    out = capsys.readouterr().out
    assert out.count("would run:") == 3 and "(dry run: no AWS)" in out


def test_bootstrap_flow_creates_and_attaches(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps({"Role": {}}), ""),
    )
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 0)
    assert seeder.seeder_bootstrap_flow(DP, EMULATOR_ENV, True, False) == 0
    out = capsys.readouterr().out
    assert f"created: {DP.seeder_role_name} (12h session cap)" in out
    assert "policy: seeder-policy attached" in out
    assert "next:" in out


def test_bootstrap_flow_refreshes_an_existing_role(monkeypatch, capsys):
    def captured(command, is_emulator, session=None):
        if "create-role" in command:
            return (
                1,
                "",
                "An error occurred (EntityAlreadyExists) when calling the CreateRole operation",
            )
        return 0, "", ""

    monkeypatch.setattr(seeder, "run_aws_captured", captured)
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 0)
    assert seeder.seeder_bootstrap_flow(DP, EMULATOR_ENV, True, False) == 0
    out = capsys.readouterr().out
    assert f"ok: role {DP.seeder_role_name} already exists" in out
    assert "session: 12h cap refreshed" in out


def test_bootstrap_flow_warns_when_the_cap_refresh_fails(monkeypatch, capsys):
    def captured(command, is_emulator, session=None):
        if "create-role" in command:
            return (
                1,
                "",
                "An error occurred (EntityAlreadyExists) when calling the CreateRole operation",
            )
        return 1, "", "update failed"

    monkeypatch.setattr(seeder, "run_aws_captured", captured)
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 0)
    assert seeder.seeder_bootstrap_flow(DP, EMULATOR_ENV, True, False) == 0
    out = capsys.readouterr().out
    assert "warning: could not refresh the session cap" in out
    assert "fix: aws iam update-role" in out
    assert "policy: seeder-policy attached" in out


def test_bootstrap_flow_reports_create_failures(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "AccessDenied"),
    )
    assert seeder.seeder_bootstrap_flow(DP, EMULATOR_ENV, True, False) == 1
    out = capsys.readouterr().out
    assert "error: create-role failed" in out and "AccessDenied" in out


def test_bootstrap_flow_reports_policy_failures(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder, "run_aws_captured", lambda command, is_emulator, session=None: (0, "{}", "")
    )
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 1)
    assert seeder.seeder_bootstrap_flow(DP, EMULATOR_ENV, True, False) == 1
    assert "fix: inspect the role" in capsys.readouterr().out


def test_role_exists_probe(monkeypatch):
    monkeypatch.setattr(
        seeder, "run_aws_captured", lambda command, is_emulator, session=None: (0, "{}", "")
    )
    assert seeder.seeder_role_exists(DP, EMULATOR_ENV, True) is True
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (254, "", "NoSuchEntity"),
    )
    assert seeder.seeder_role_exists(DP, EMULATOR_ENV, True) is False


def test_drop_flow_dry_run(monkeypatch, capsys):
    def boom(*arguments, **rest):
        raise AssertionError("dry run must not touch AWS")

    monkeypatch.setattr(seeder, "run_aws", boom)
    monkeypatch.setattr(seeder, "seeder_role_exists", boom)
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, True) == 0
    out = capsys.readouterr().out
    assert out.count("would run:") == 2 and "(dry run: no AWS)" in out


def test_drop_flow_noop_when_role_missing(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder, "seeder_role_exists", lambda declaration, values, is_emulator: False
    )
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 0
    assert "does not exist; nothing to drop" in capsys.readouterr().out


def test_drop_flow_emulator_never_prompts(monkeypatch, capsys):
    monkeypatch.setattr(seeder, "seeder_role_exists", lambda declaration, values, is_emulator: True)

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 0)
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 0
    out = capsys.readouterr().out
    assert "detached: seeder-policy" in out
    assert f"deleted: {DP.seeder_role_name}" in out


def test_drop_flow_real_barrier(monkeypatch, capsys):
    monkeypatch.setattr(seeder, "seeder_role_exists", lambda declaration, values, is_emulator: True)
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert seeder.drop_seeder_flow(DP, REAL_ENV, False, False) == 1
    assert "cancelled: the seeder role is untouched" in capsys.readouterr().out


def test_drop_flow_reports_policy_and_role_failures(monkeypatch, capsys):
    monkeypatch.setattr(seeder, "seeder_role_exists", lambda declaration, values, is_emulator: True)
    codes = iter([1])
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: next(codes))
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 1
    assert "fix: detach seeder-policy" in capsys.readouterr().out

    codes = iter([0, 1])
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: next(codes))
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 1
    assert "fix: delete the role manually" in capsys.readouterr().out


def test_session_remaining_text_formats_and_tolerates_junk():
    future = {"expires_at": "2086-01-01T00:00:00Z"}
    assert seeder.session_remaining_text(future) != "??:??"
    assert seeder.session_remaining_text({}) == "??:??"
    assert seeder.session_remaining_text({"expires_at": "junk"}) == "??:??"


def test_cached_session_reads_a_live_cache(tmp_path):
    cache = tmp_path / ".aws-session.json"
    payload = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    cache.write_text(json.dumps(payload))
    assert seeder.cached_session(ROLE_ARN, cache) == payload


def test_cached_session_rejects_stale_or_foreign_caches(tmp_path):
    cache = tmp_path / ".aws-session.json"
    base = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
    }

    def write(payload):
        cache.write_text(json.dumps(payload))

    write({**base, "role_arn": "arn:aws:iam::1:role/other"})
    assert seeder.cached_session(ROLE_ARN, cache) is None
    write({**base, "expires_at": "2020-01-01T00:00:00Z"})
    assert seeder.cached_session(ROLE_ARN, cache) is None
    near = (
        datetime.now(UTC) + timedelta(seconds=seeder.SESSION_RENEWAL_MARGIN_SECONDS - 60)
    ).isoformat()
    write({**base, "expires_at": near})
    assert seeder.cached_session(ROLE_ARN, cache) is None
    write(
        {key: value for key, value in base.items() if key != "session_token"}
        | {"expires_at": "2086-01-01T00:00:00Z"}
    )
    assert seeder.cached_session(ROLE_ARN, cache) is None
    cache.write_text("{not json")
    assert seeder.cached_session(ROLE_ARN, cache) is None
    assert seeder.cached_session(ROLE_ARN, tmp_path / "absent.json") is None


def test_save_cached_session_is_atomic_and_private(tmp_path):
    cache = tmp_path / "infra" / ".aws-session.json"
    session = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    seeder.save_cached_session(session, cache)
    assert json.loads(cache.read_text())["role_arn"] == ROLE_ARN
    assert cache.stat().st_mode & 0o777 == 0o600


def test_clear_cached_session_reports_idempotence(tmp_path):
    cache = tmp_path / "c.json"
    cache.write_text("{}")
    assert seeder.clear_cached_session(cache) is True
    assert seeder.clear_cached_session(cache) is False


def test_assume_seeder_session_prompts_and_returns_the_triplet(monkeypatch, capsys):
    payload = {
        "Credentials": {
            "AccessKeyId": "A",
            "SecretAccessKey": "B",
            "SessionToken": "C",
            "Expiration": "2086-01-01T00:00:00Z",
        },
        "AssumedRoleUser": {
            "Arn": f"arn:aws:sts::123456789012:assumed-role/{DP.seeder_role_name}/session"
        },
    }
    seen = {}

    def captured(command, is_emulator, session=None):
        seen["command"] = command
        return 0, json.dumps(payload), ""

    monkeypatch.setattr(seeder, "run_aws_captured", captured)
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    session = seeder.assume_seeder_session(
        ROLE_ARN, "arn:aws:iam::123456789012:mfa/kunalpisolkar", DP
    )
    assert session["access_key_id"] == "A" and session["role_arn"] == ROLE_ARN
    command = seen["command"]
    assert "--token-code" in command and "654321" in command
    assert "--serial-number" in command
    assert "--duration-seconds" in command and "43200" in command
    assert "--role-session-name" in command
    assert "carrier: assuming detectai-document-parser-seeder" in capsys.readouterr().out


def test_assume_rejects_non_numeric_codes(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda prompt="": "12a456")
    with pytest.raises(SystemExit) as excinfo:
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1


def test_assume_failure_hints_at_the_bootstrap_verb(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "AccessDenied"),
    )
    with pytest.raises(SystemExit) as excinfo:
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1
    assert "seeder-bootstrap verb" in capsys.readouterr().out


def test_assume_failure_hints_at_the_session_cap(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    stderr = "The requested DurationSeconds exceeds the MaxSessionDuration set for this role"
    monkeypatch.setattr(
        seeder, "run_aws_captured", lambda command, is_emulator, session=None: (1, "", stderr)
    )
    with pytest.raises(SystemExit):
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert "session cap" in capsys.readouterr().out


def test_assume_rejects_a_foreign_identity(monkeypatch):
    payload = {
        "Credentials": {"AccessKeyId": "A", "SecretAccessKey": "B", "SessionToken": "C"},
        "AssumedRoleUser": {"Arn": "arn:aws:sts::123456789012:assumed-role/OtherRole/session"},
    }
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps(payload), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    with pytest.raises(SystemExit) as excinfo:
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1


def test_assume_rejects_incomplete_credentials(monkeypatch):
    payload = {
        "Credentials": {},
        "AssumedRoleUser": {
            "Arn": f"arn:aws:sts::123456789012:assumed-role/{DP.seeder_role_name}/session"
        },
    }
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps(payload), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    with pytest.raises(SystemExit):
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)


def test_resolve_carrier_session_short_circuits_off_the_real_plane(tmp_path):
    cache = tmp_path / "c.json"
    assert seeder.resolve_carrier_session(DP, EMULATOR_ENV, True, False, cache) is None
    assert seeder.resolve_carrier_session(DP, REAL_ENV, False, True, cache) is None


def test_resolve_carrier_session_reuses_a_cached_triplet(tmp_path, monkeypatch):
    cache = tmp_path / "c.json"
    payload = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    cache.write_text(json.dumps(payload))
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", USER_ARN))

    def boom(*arguments, **rest):
        raise AssertionError("a live cache must not prompt")

    monkeypatch.setattr(seeder, "assume_seeder_session", boom)
    assert seeder.resolve_carrier_session(DP, REAL_ENV, False, False, cache) == payload


def test_resolve_carrier_session_assumes_and_saves_when_uncached(tmp_path, monkeypatch):
    cache = tmp_path / "c.json"
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    fresh = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    monkeypatch.setattr(
        seeder, "assume_seeder_session", lambda role_arn, serial, declaration: fresh
    )
    assert seeder.resolve_carrier_session(DP, REAL_ENV, False, False, cache) == fresh
    assert json.loads(cache.read_text())["role_arn"] == ROLE_ARN


def test_resolve_carrier_session_dies_without_an_mfa_serial(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        seeder,
        "sts_caller_identity",
        lambda: ("123456789012", "arn:aws:sts::123456789012:assumed-role/Ops/s"),
    )
    with pytest.raises(SystemExit) as excinfo:
        seeder.resolve_carrier_session(DP, REAL_ENV, False, False, tmp_path / "c")
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "cannot derive" in out and "SEEDER_MFA_SERIAL" in out
