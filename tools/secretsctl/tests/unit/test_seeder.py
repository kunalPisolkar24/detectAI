"""Seeder carrier: trust ladder, MFA serials, cached sessions, create-on-demand, and drop flows."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from conftest import DP, EMULATOR_ENV, REAL_ENV, ROLE_ARN, USER_ARN
from app import seeder

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
    assert seeder.resolve_trust_principal(DP, True) == (
        f"arn:aws:iam::000000000000:user/{DP.seeder_role_name}"
    )


def test_resolve_trust_principal_real_uses_the_ambient_user(monkeypatch):
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    assert seeder.resolve_trust_principal(DP, False) == USER_ARN


def test_resolve_trust_principal_promotes_role_sessions_to_their_base_role(monkeypatch, capsys):
    session_arn = "arn:aws:sts::123456789012:assumed-role/OpsRole/sess"
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", session_arn))
    principal = seeder.resolve_trust_principal(DP, False)
    assert principal == "arn:aws:iam::123456789012:role/OpsRole"
    assert "its base role becomes the trust principal" in capsys.readouterr().out


def test_resolve_trust_principal_rejects_root(monkeypatch):
    monkeypatch.setattr(
        seeder, "sts_caller_identity", lambda: ("123456789012", "arn:aws:iam::123456789012:root")
    )
    with pytest.raises(SystemExit) as excinfo:
        seeder.resolve_trust_principal(DP, False)
    assert excinfo.value.code == 1


def test_resolve_trust_principal_rejects_an_existing_seeder_session(monkeypatch, capsys):
    session_arn = f"arn:aws:sts::123456789012:assumed-role/{DP.seeder_role_name}/sess"
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", session_arn))
    with pytest.raises(SystemExit) as excinfo:
        seeder.resolve_trust_principal(DP, False)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "already a detectai-document-parser-seeder session" in out
    assert "session-clear" in out


def test_mfa_serial_ladder():
    assert seeder.mfa_serial_for(USER_ARN, "") == "arn:aws:iam::123456789012:mfa/kunalpisolkar"
    override = "arn:aws:iam::123456789012:mfa/custom-device"
    assert seeder.mfa_serial_for(USER_ARN, override) == override
    assert seeder.mfa_serial_for("arn:aws:iam::123456789012:role/OpsRole", "") is None


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
    assert bucket["Resource"] == ["arn:aws:s3:::detectai-document-parser-tfstate-000000000000"]
    assert objects["Resource"] == ["arn:aws:s3:::detectai-document-parser-tfstate-000000000000/*"]
    assert secret["Resource"] == [
        "arn:aws:secretsmanager:ap-southeast-2:123456789012:secret:detectai/document-parser/secrets-*"
    ]
    assert ssm["Resource"] == [
        "arn:aws:ssm:ap-southeast-2:123456789012:parameter/detectai/document-parser/*"
    ]
    assert describe["Resource"] == ["*"]


def test_policy_bucket_pin_follows_the_plane_account():
    emulator_placeholder = seeder.resolve_trust_principal(DP, True)
    real = seeder.seeder_policy_document(DP, REAL_ENV, False, USER_ARN)
    assert real["Statement"][0]["Resource"] == [
        "arn:aws:s3:::detectai-document-parser-tfstate-123456789012"
    ]
    assert emulator_placeholder == f"arn:aws:iam::000000000000:user/{DP.seeder_role_name}"


def fake_triplet(role_arn):
    return {
        "role_arn": role_arn,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }


def test_plane_account_routes_by_plane_and_session(monkeypatch):
    assert seeder.plane_account(None, True) == "000000000000"
    session = fake_triplet(ROLE_ARN)
    assert seeder.plane_account(session, False) == "123456789012"

    def boom(*arguments, **rest):
        raise AssertionError("a live session must not shell out for identity")

    monkeypatch.setattr(seeder, "sts_caller_identity", boom)
    assert seeder.plane_account(session, False) == "123456789012"

    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("436242974989", USER_ARN))
    assert seeder.plane_account(None, False) == "436242974989"  # the real dry-run lookup


def test_role_payload_probe(monkeypatch):
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (
            0,
            json.dumps({"Role": {"RoleName": DP.seeder_role_name}}),
            "",
        ),
    )
    assert seeder.seeder_role_payload(DP, EMULATOR_ENV, True)["Role"]["RoleName"] == (
        DP.seeder_role_name
    )
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (254, "", "NoSuchEntity"),
    )
    assert seeder.seeder_role_payload(DP, EMULATOR_ENV, True) is None
    monkeypatch.setattr(
        seeder, "run_aws_captured", lambda command, is_emulator, session=None: (0, "{not json", "")
    )
    assert seeder.seeder_role_payload(DP, EMULATOR_ENV, True) is None


def test_ensure_seeder_role_creates_a_missing_role(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    monkeypatch.setattr(seeder, "seeder_role_payload", lambda declaration, values, is_em: None)
    calls: list[list[str]] = []

    def fake_captured(command, is_emulator, session=None):
        calls.append(list(command))
        return 0, "", ""

    monkeypatch.setattr(seeder, "run_aws_captured", fake_captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0

    monkeypatch.setattr(seeder, "run_aws", fake_run)
    seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    out = capsys.readouterr().out
    assert f"note: seeder role {DP.seeder_role_name} is missing; creating it" in out
    assert f"created: {DP.seeder_role_name} (12h session cap)" in out
    assert "policy: seeder-policy attached" in out
    create = next(command for command in calls if "create-role" in command)
    assert json.loads(create[create.index("--assume-role-policy-document") + 1]) == (
        seeder.seeder_trust_document(EMULATOR_TRUST_ARN)
    )
    put = next(command for command in calls if "put-role-policy" in command)
    assert json.loads(put[put.index("--policy-document") + 1]) == (
        seeder.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    )
    assert not any("update-role" in command for command in calls)  # the create carries the cap


def test_ensure_seeder_role_passes_a_converged_role_silently(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    desired_policy = seeder.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    converged = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": seeder.SESSION_DURATION_SECONDS,
        "AssumeRolePolicyDocument": seeder.seeder_trust_document(EMULATOR_TRUST_ARN),
    }

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(desired_policy)}), ""
        return 0, json.dumps({"Role": converged}), ""

    def boom(*arguments, **rest):
        raise AssertionError("a converged role must not be written")

    monkeypatch.setattr(seeder, "run_aws_captured", captured)
    monkeypatch.setattr(seeder, "run_aws", boom)
    seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    assert capsys.readouterr().out == ""


def test_ensure_seeder_role_reanchors_drifted_trust(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    desired_policy = seeder.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    stale = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": seeder.SESSION_DURATION_SECONDS,
        "AssumeRolePolicyDocument": seeder.seeder_trust_document(
            "arn:aws:iam::123456789012:user/old-owner"
        ),
    }
    calls: list[list[str]] = []

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(desired_policy)}), ""
        return 0, json.dumps({"Role": stale}), ""

    monkeypatch.setattr(seeder, "run_aws_captured", captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0

    monkeypatch.setattr(seeder, "run_aws", fake_run)
    seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    out = capsys.readouterr().out
    assert f"note: re-anchoring {DP.seeder_role_name}'s trust to the caller" in out
    re_anchor = next(command for command in calls if "update-assume-role-policy" in command)
    assert json.loads(re_anchor[re_anchor.index("--policy-document") + 1]) == (
        seeder.seeder_trust_document(EMULATOR_TRUST_ARN)
    )
    assert not any("put-role-policy" in command for command in calls)


def test_ensure_seeder_role_raises_a_legacy_cap(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    desired_policy = seeder.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    legacy = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": 3600,
        "AssumeRolePolicyDocument": seeder.seeder_trust_document(EMULATOR_TRUST_ARN),
    }
    calls: list[list[str]] = []

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(desired_policy)}), ""
        return 0, json.dumps({"Role": legacy}), ""

    monkeypatch.setattr(seeder, "run_aws_captured", captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0 if "--max-session-duration" not in command else 1

    monkeypatch.setattr(seeder, "run_aws", fake_run)
    seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    out = capsys.readouterr().out
    assert f"note: raising {DP.seeder_role_name}'s session cap to 12h" in out
    assert f"warning: could not raise {DP.seeder_role_name}'s session cap" in out
    assert any("update-role" in command for command in calls)


def test_ensure_seeder_role_reputs_a_drifted_policy(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    converged = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": seeder.SESSION_DURATION_SECONDS,
        "AssumeRolePolicyDocument": seeder.seeder_trust_document(EMULATOR_TRUST_ARN),
    }
    stale_policy = {"Version": "2012-10-17", "Statement": [{"Sid": "RunTerraformStateBucket"}]}
    calls: list[list[str]] = []

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(stale_policy)}), ""
        return 0, json.dumps({"Role": converged}), ""

    monkeypatch.setattr(seeder, "run_aws_captured", captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0

    monkeypatch.setattr(seeder, "run_aws", fake_run)
    seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    out = capsys.readouterr().out
    assert f"note: re-attaching {seeder.SEEDER_POLICY_NAME} (drifted from the code's pin)" in out
    put = next(command for command in calls if "put-role-policy" in command)
    assert json.loads(put[put.index("--policy-document") + 1]) == (
        seeder.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    )


def test_ensure_seeder_role_dies_when_create_fails(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    monkeypatch.setattr(seeder, "seeder_role_payload", lambda declaration, values, is_em: None)
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "AccessDenied"),
    )
    with pytest.raises(SystemExit) as excinfo:
        seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "error: create-role failed" in out and "AccessDenied" in out


def test_ensure_seeder_role_dies_when_the_policy_attach_fails(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    monkeypatch.setattr(seeder, "seeder_role_payload", lambda declaration, values, is_em: None)
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (
            0,
            "",
            "An error occurred (EntityAlreadyExists) when calling the CreateRole operation",
        ),
    )
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 1)
    with pytest.raises(SystemExit) as excinfo:
        seeder._ensure_seeder_role(DP, EMULATOR_ENV, True)
    assert excinfo.value.code == 1
    assert "could not attach seeder-policy" in capsys.readouterr().out


def test_drop_flow_dry_run(monkeypatch, capsys):
    def boom(*arguments, **rest):
        raise AssertionError("dry run must not touch AWS")

    monkeypatch.setattr(seeder, "run_aws", boom)
    monkeypatch.setattr(seeder, "seeder_role_payload", boom)
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, True) == 0
    out = capsys.readouterr().out
    assert out.count("would run:") == 2 and "(dry run: no AWS)" in out


def test_drop_flow_noop_when_role_missing(monkeypatch, capsys):
    monkeypatch.setattr(seeder, "seeder_role_payload", lambda declaration, values, is_em: None)
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 0
    assert "does not exist; nothing to drop" in capsys.readouterr().out


def test_drop_flow_emulator_never_prompts(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder, "seeder_role_payload", lambda declaration, values, is_em: {"Role": {}}
    )

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    monkeypatch.setattr(seeder, "run_aws", lambda command, is_emulator, session=None: 0)
    assert seeder.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 0
    out = capsys.readouterr().out
    assert "detached: seeder-policy" in out
    assert f"deleted: {DP.seeder_role_name}" in out


def test_drop_flow_real_barrier(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder, "seeder_role_payload", lambda declaration, values, is_em: {"Role": {}}
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "wrong-name")
    assert seeder.drop_seeder_flow(DP, REAL_ENV, False, False) == 1
    assert "cancelled: the seeder role is untouched" in capsys.readouterr().out


def test_drop_flow_reports_policy_and_role_failures(monkeypatch, capsys):
    monkeypatch.setattr(
        seeder, "seeder_role_payload", lambda declaration, values, is_em: {"Role": {}}
    )
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


def test_assume_failure_hints_at_the_trust_or_mfa(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    monkeypatch.setattr(
        seeder,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "AccessDenied"),
    )
    with pytest.raises(SystemExit) as excinfo:
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1
    assert "trusts your caller" in capsys.readouterr().out


def test_assume_failure_hints_at_the_session_cap(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    stderr = "The requested DurationSeconds exceeds the MaxSessionDuration set for this role"
    monkeypatch.setattr(
        seeder, "run_aws_captured", lambda command, is_emulator, session=None: (1, "", stderr)
    )
    with pytest.raises(SystemExit):
        seeder.assume_seeder_session(ROLE_ARN, "serial", DP)
    out = capsys.readouterr().out
    assert "session cap" in out and "aws iam update-role" in out


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


def test_assume_seeder_session_on_the_emulator_skips_the_prompt(monkeypatch, capsys):
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
        seen["is_emulator"] = is_emulator
        return 0, json.dumps(payload), ""

    monkeypatch.setattr(seeder, "run_aws_captured", captured)

    def no_prompt(prompt=""):
        raise AssertionError("the emulator assume must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    session = seeder.assume_seeder_session(EMULATOR_ROLE_ARN, None, DP, True)
    assert session["access_key_id"] == "A" and session["role_arn"] == EMULATOR_ROLE_ARN
    assert "--token-code" not in seen["command"] and "--serial-number" not in seen["command"]
    assert seen["is_emulator"] is True
    assert "carrier: assuming detectai-document-parser-seeder" in capsys.readouterr().out


EMULATOR_TRUST_ARN = f"arn:aws:iam::000000000000:user/{DP.seeder_role_name}"
EMULATOR_ROLE_ARN = seeder.seeder_role_arn(DP, "000000000000")


def emulator_trust(monkeypatch):
    monkeypatch.setattr(seeder, "resolve_trust_principal", lambda d, e: EMULATOR_TRUST_ARN)


def fresh_triplet():
    return {
        "role_arn": EMULATOR_ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }


def test_resolve_carrier_session_is_dry_run_free_on_both_planes(tmp_path):
    cache = tmp_path / "c.json"
    assert seeder.resolve_carrier_session(DP, EMULATOR_ENV, True, True, cache) is None
    assert seeder.resolve_carrier_session(DP, REAL_ENV, False, True, cache) is None


def test_resolve_carrier_session_on_the_emulator_assumes_without_mfa(tmp_path, monkeypatch, capsys):
    emulator_trust(monkeypatch)
    healed = {}

    def fake_heal(declaration, values, is_emulator):
        healed["plane"] = is_emulator

    monkeypatch.setattr(seeder, "_ensure_seeder_role", fake_heal)
    seen = {}

    def fake_assume(role_arn, serial, declaration, is_emulator=False):
        seen["role_arn"] = role_arn
        seen["serial"] = serial
        seen["is_emulator"] = is_emulator
        return fresh_triplet()

    monkeypatch.setattr(seeder, "assume_seeder_session", fake_assume)
    cache = tmp_path / "c.json"
    assert seeder.resolve_carrier_session(DP, EMULATOR_ENV, True, False, cache) == fresh_triplet()
    assert healed["plane"] is True
    assert seen["role_arn"] == EMULATOR_ROLE_ARN
    assert seen["serial"] is None and seen["is_emulator"] is True
    assert json.loads(cache.read_text())["role_arn"] == EMULATOR_ROLE_ARN


def test_resolve_carrier_session_on_the_emulator_reuses_a_cached_triplet(
    tmp_path, monkeypatch, capsys
):
    emulator_trust(monkeypatch)
    cache = tmp_path / "c.json"
    cache.write_text(json.dumps(fresh_triplet()))

    def boom(*arguments, **rest):
        raise AssertionError("a cached emulator session must not touch the role or assume")

    monkeypatch.setattr(seeder, "_ensure_seeder_role", boom)
    monkeypatch.setattr(seeder, "assume_seeder_session", boom)
    assert seeder.resolve_carrier_session(DP, EMULATOR_ENV, True, False, cache) == fresh_triplet()


def test_resolve_carrier_session_on_real_aws_converges_and_assumes_with_mfa(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.setattr(seeder, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    healed = {}

    def fake_heal(declaration, values, is_emulator):
        healed["plane"] = is_emulator

    monkeypatch.setattr(seeder, "_ensure_seeder_role", fake_heal)
    seen = {}

    def fake_assume(role_arn, serial, declaration, is_emulator=False):
        seen["role_arn"] = role_arn
        seen["serial"] = serial
        seen["is_emulator"] = is_emulator
        return fake_triplet(role_arn)

    monkeypatch.setattr(seeder, "assume_seeder_session", fake_assume)
    cache = tmp_path / "c.json"
    assert seeder.resolve_carrier_session(DP, REAL_ENV, False, False, cache) == fake_triplet(
        ROLE_ARN
    )
    assert healed["plane"] is False
    assert seen["role_arn"] == ROLE_ARN
    assert seen["is_emulator"] is False
    # the MFA serial derives from the trusted caller, no .env override needed
    assert seen["serial"] == "arn:aws:iam::123456789012:mfa/kunalpisolkar"
    assert json.loads(cache.read_text())["role_arn"] == ROLE_ARN


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
    monkeypatch.setattr(seeder, "_ensure_seeder_role", lambda declaration, values, is_em: None)
    fresh = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    monkeypatch.setattr(
        seeder, "assume_seeder_session", lambda role_arn, serial, declaration, is_emulator: fresh
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
