"""Seeder carrier: trust ladder, MFA serials, cached sessions, create-on-demand, and drop flows."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from conftest import DP, DP_TOML, EMULATOR_ENV, KIND, REAL_ENV, ROLE_ARN, USER_ARN, render_env
from app.engine.carrier import identity, policy, role, session
from app.engine.values import rules
from app.kinds.locate import Workspace, workspace_for
from app.kinds.secrets import batch
from app.kinds.secrets import policy as secrets_policy

pytestmark = pytest.mark.unit


def test_role_session_name_sanitizes_the_user(monkeypatch):
    monkeypatch.setattr(session.getpass, "getuser", lambda: "kunal p")
    assert session.role_session_name(DP) == "document-parser-kunal.p"


def test_seeder_role_arn_and_session_mark():
    assert identity.seeder_role_arn(DP, "123456789012") == ROLE_ARN
    assert identity.seeder_role_session_mark(DP) == "assumed-role/detectai-document-parser-seeder/"


def test_role_arn_of_session_strips_the_session_and_keeps_the_path():
    flat = "arn:aws:sts::123456789012:assumed-role/OpsRole/sess"
    assert identity.role_arn_of_session(flat) == "arn:aws:iam::123456789012:role/OpsRole"
    pathed = "arn:aws:sts::123456789012:assumed-role/team/OpsRole/sess"
    assert identity.role_arn_of_session(pathed) == "arn:aws:iam::123456789012:role/team/OpsRole"


def test_iam_account_id_reads_the_account_and_rejects_non_iam_principals():
    assert identity.iam_account_id(USER_ARN) == "123456789012"
    with pytest.raises(SystemExit) as excinfo:
        identity.iam_account_id("arn:aws:s3:::some-bucket")
    assert excinfo.value.code == 1


def test_resolve_trust_principal_emulator_placeholder_derives_from_the_role():
    assert policy.resolve_trust_principal(DP, True) == (
        f"arn:aws:iam::000000000000:user/{DP.seeder_role_name}"
    )


def test_resolve_trust_principal_real_uses_the_ambient_user(monkeypatch):
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    assert policy.resolve_trust_principal(DP, False) == USER_ARN


def test_resolve_trust_principal_promotes_role_sessions_to_their_base_role(monkeypatch, capsys):
    session_arn = "arn:aws:sts::123456789012:assumed-role/OpsRole/sess"
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", session_arn))
    principal = policy.resolve_trust_principal(DP, False)
    assert principal == "arn:aws:iam::123456789012:role/OpsRole"
    assert "its base role becomes the trust principal" in capsys.readouterr().out


def test_resolve_trust_principal_rejects_root(monkeypatch):
    monkeypatch.setattr(
        policy, "sts_caller_identity", lambda: ("123456789012", "arn:aws:iam::123456789012:root")
    )
    with pytest.raises(SystemExit) as excinfo:
        policy.resolve_trust_principal(DP, False)
    assert excinfo.value.code == 1


def test_resolve_trust_principal_rejects_an_existing_seeder_session(monkeypatch, capsys):
    session_arn = f"arn:aws:sts::123456789012:assumed-role/{DP.seeder_role_name}/sess"
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", session_arn))
    with pytest.raises(SystemExit) as excinfo:
        policy.resolve_trust_principal(DP, False)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "already a detectai-document-parser-seeder session" in out
    assert "session-clear" in out


def test_mfa_serial_ladder():
    assert session.mfa_serial_for(USER_ARN, "") == "arn:aws:iam::123456789012:mfa/kunalpisolkar"
    override = "arn:aws:iam::123456789012:mfa/custom-device"
    assert session.mfa_serial_for(USER_ARN, override) == override
    assert session.mfa_serial_for("arn:aws:iam::123456789012:role/OpsRole", "") is None


def test_seeder_drop_validates_plane_inputs_only():
    assert rules.plane_errors(EMULATOR_ENV) == []
    errors = "\n".join(rules.plane_errors({"AWS_REGION": "Mars-1"}))
    assert "AWS_REGION" in errors


def test_trust_document_requires_mfa():
    document = policy.seeder_trust_document(USER_ARN)
    statement = document["Statement"][0]
    assert statement["Principal"] == {"AWS": USER_ARN}
    assert statement["Action"] == "sts:AssumeRole"
    assert statement["Condition"] == {"Bool": {"aws:MultiFactorAuthPresent": "true"}}


def test_policy_document_scopes_every_service_pinned_arn():
    document = secrets_policy.seeder_policy_document(DP, EMULATOR_ENV, True, USER_ARN)
    sids = [statement["Sid"] for statement in document["Statement"]]
    assert sids == [
        "RunTerraformStateBucket",
        "RunTerraformStateObjects",
        "ManageServiceSecret",
        "ManageServiceConfig",
        "DescribeSsmParameters",
    ]
    bucket, objects, secret, ssm, describe = document["Statement"]
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
    emulator_placeholder = policy.resolve_trust_principal(DP, True)
    real = secrets_policy.seeder_policy_document(DP, REAL_ENV, False, USER_ARN)
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
    assert identity.plane_account(None, True) == "000000000000"
    session = fake_triplet(ROLE_ARN)
    assert identity.plane_account(session, False) == "123456789012"

    def boom(*arguments, **rest):
        raise AssertionError("a live session must not shell out for identity")

    monkeypatch.setattr(identity, "sts_caller_identity", boom)
    assert identity.plane_account(session, False) == "123456789012"

    monkeypatch.setattr(identity, "sts_caller_identity", lambda: ("436242974989", USER_ARN))
    assert identity.plane_account(None, False) == "436242974989"  # the real dry-run lookup


def test_role_payload_probe(monkeypatch):
    monkeypatch.setattr(
        role,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (
            0,
            json.dumps({"Role": {"RoleName": DP.seeder_role_name}}),
            "",
        ),
    )
    assert role.seeder_role_payload(DP, EMULATOR_ENV, True)["Role"]["RoleName"] == (
        DP.seeder_role_name
    )
    monkeypatch.setattr(
        role,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (254, "", "NoSuchEntity"),
    )
    assert role.seeder_role_payload(DP, EMULATOR_ENV, True) is None
    monkeypatch.setattr(
        role, "run_aws_captured", lambda command, is_emulator, session=None: (0, "{not json", "")
    )
    assert role.seeder_role_payload(DP, EMULATOR_ENV, True) is None


def test_ensure_seeder_role_creates_a_missing_role(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    monkeypatch.setattr(role, "seeder_role_payload", lambda declaration, values, is_em: None)
    calls: list[list[str]] = []

    def fake_captured(command, is_emulator, session=None):
        calls.append(list(command))
        return 0, "", ""

    monkeypatch.setattr(role, "run_aws_captured", fake_captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0

    monkeypatch.setattr(role, "run_aws", fake_run)
    role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    out = capsys.readouterr().out
    assert f"note: seeder role {DP.seeder_role_name} is missing; creating it" in out
    assert f"created: {DP.seeder_role_name} (12h session cap)" in out
    assert "policy: seeder-policy attached" in out
    create = next(command for command in calls if "create-role" in command)
    assert json.loads(create[create.index("--assume-role-policy-document") + 1]) == (
        policy.seeder_trust_document(EMULATOR_TRUST_ARN)
    )
    put = next(command for command in calls if "put-role-policy" in command)
    assert json.loads(put[put.index("--policy-document") + 1]) == (
        secrets_policy.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    )
    assert not any("update-role" in command for command in calls)  # the create carries the cap


def test_ensure_seeder_role_prints_scopes_for_a_sid_less_policy(monkeypatch, capsys):
    """A kind's policy statements may omit Sids: the create path must not
    assume them (the observability kind once crashed here on a fresh plane)."""
    emulator_trust(monkeypatch)
    sid_less_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {"Effect": "Allow", "Action": ["s3:CreateBucket"], "Resource": ["arn:aws:s3:::b"]},
            {"Effect": "Allow", "Action": ["s3:GetObject"], "Resource": ["arn:aws:s3:::b/*"]},
        ],
    }
    monkeypatch.setattr(role, "seeder_role_payload", lambda declaration, values, is_em: None)
    monkeypatch.setattr(role, "run_aws_captured", lambda command, is_emulator, session=None: (0, "", ""))
    monkeypatch.setattr(role, "run_aws", lambda command, is_emulator, session=None: 0)
    role._ensure_seeder_role(DP, EMULATOR_ENV, True, lambda d, v, e, u: sid_less_policy)
    out = capsys.readouterr().out
    assert "policy: seeder-policy attached (s3:CreateBucket, s3:GetObject)" in out


def test_policy_scopes_prefers_sids_and_survives_actionless_statements():
    assert role._policy_scopes({"Statement": [{"Sid": "Named", "Effect": "Allow"}]}) == "Named"
    assert role._policy_scopes({"Statement": [{"Effect": "Allow", "Action": ["a", "b"]}]}) == "a"
    assert role._policy_scopes({"Statement": [{"Effect": "Allow", "Action": "s3:ListBucket"}]}) == (
        "s3:ListBucket"
    )
    assert role._policy_scopes({"Statement": [{"Effect": "Allow"}]}) == "unnamed-statement"


def test_ensure_seeder_role_passes_a_converged_role_silently(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    desired_policy = secrets_policy.seeder_policy_document(
        DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN
    )
    converged = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": identity.SESSION_DURATION_SECONDS,
        "AssumeRolePolicyDocument": policy.seeder_trust_document(EMULATOR_TRUST_ARN),
    }

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(desired_policy)}), ""
        return 0, json.dumps({"Role": converged}), ""

    def boom(*arguments, **rest):
        raise AssertionError("a converged role must not be written")

    monkeypatch.setattr(role, "run_aws_captured", captured)
    monkeypatch.setattr(role, "run_aws", boom)
    role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    assert capsys.readouterr().out == ""


def test_ensure_seeder_role_reanchors_drifted_trust(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    desired_policy = secrets_policy.seeder_policy_document(
        DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN
    )
    stale = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": identity.SESSION_DURATION_SECONDS,
        "AssumeRolePolicyDocument": policy.seeder_trust_document(
            "arn:aws:iam::123456789012:user/old-owner"
        ),
    }
    calls: list[list[str]] = []

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(desired_policy)}), ""
        return 0, json.dumps({"Role": stale}), ""

    monkeypatch.setattr(role, "run_aws_captured", captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0

    monkeypatch.setattr(role, "run_aws", fake_run)
    role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    out = capsys.readouterr().out
    assert f"note: re-anchoring {DP.seeder_role_name}'s trust to the caller" in out
    re_anchor = next(command for command in calls if "update-assume-role-policy" in command)
    assert json.loads(re_anchor[re_anchor.index("--policy-document") + 1]) == (
        policy.seeder_trust_document(EMULATOR_TRUST_ARN)
    )
    assert not any("put-role-policy" in command for command in calls)


def test_ensure_seeder_role_raises_a_legacy_cap(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    desired_policy = secrets_policy.seeder_policy_document(
        DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN
    )
    legacy = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": 3600,
        "AssumeRolePolicyDocument": policy.seeder_trust_document(EMULATOR_TRUST_ARN),
    }
    calls: list[list[str]] = []

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(desired_policy)}), ""
        return 0, json.dumps({"Role": legacy}), ""

    monkeypatch.setattr(role, "run_aws_captured", captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0 if "--max-session-duration" not in command else 1

    monkeypatch.setattr(role, "run_aws", fake_run)
    role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    out = capsys.readouterr().out
    assert f"note: raising {DP.seeder_role_name}'s session cap to 12h" in out
    assert f"warning: could not raise {DP.seeder_role_name}'s session cap" in out
    assert any("update-role" in command for command in calls)


def test_ensure_seeder_role_reputs_a_drifted_policy(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    converged = {
        "RoleName": DP.seeder_role_name,
        "MaxSessionDuration": identity.SESSION_DURATION_SECONDS,
        "AssumeRolePolicyDocument": policy.seeder_trust_document(EMULATOR_TRUST_ARN),
    }
    stale_policy = {"Version": "2012-10-17", "Statement": [{"Sid": "RunTerraformStateBucket"}]}
    calls: list[list[str]] = []

    def captured(command, is_emulator, session=None):
        if "get-role-policy" in command:
            return 0, json.dumps({"PolicyDocument": json.dumps(stale_policy)}), ""
        return 0, json.dumps({"Role": converged}), ""

    monkeypatch.setattr(role, "run_aws_captured", captured)

    def fake_run(command, is_emulator, session=None):
        calls.append(list(command))
        return 0

    monkeypatch.setattr(role, "run_aws", fake_run)
    role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    out = capsys.readouterr().out
    assert f"note: re-attaching {role.SEEDER_POLICY_NAME} (drifted from the code's pin)" in out
    put = next(command for command in calls if "put-role-policy" in command)
    assert json.loads(put[put.index("--policy-document") + 1]) == (
        secrets_policy.seeder_policy_document(DP, EMULATOR_ENV, True, EMULATOR_TRUST_ARN)
    )


def test_ensure_seeder_role_dies_when_create_fails(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    monkeypatch.setattr(role, "seeder_role_payload", lambda declaration, values, is_em: None)
    monkeypatch.setattr(
        role,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "AccessDenied"),
    )
    with pytest.raises(SystemExit) as excinfo:
        role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "error: create-role failed" in out and "AccessDenied" in out


def test_ensure_seeder_role_dies_when_the_policy_attach_fails(monkeypatch, capsys):
    emulator_trust(monkeypatch)
    monkeypatch.setattr(role, "seeder_role_payload", lambda declaration, values, is_em: None)
    monkeypatch.setattr(
        role,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (
            0,
            "",
            "An error occurred (EntityAlreadyExists) when calling the CreateRole operation",
        ),
    )
    monkeypatch.setattr(role, "run_aws", lambda command, is_emulator, session=None: 1)
    with pytest.raises(SystemExit) as excinfo:
        role._ensure_seeder_role(DP, EMULATOR_ENV, True, secrets_policy.seeder_policy_document)
    assert excinfo.value.code == 1
    assert "could not attach seeder-policy" in capsys.readouterr().out


def test_drop_flow_dry_run(monkeypatch, capsys):
    def boom(*arguments, **rest):
        raise AssertionError("dry run must not touch AWS")

    monkeypatch.setattr(role, "run_aws", boom)
    monkeypatch.setattr(role, "seeder_role_payload", boom)
    assert role.drop_seeder_flow(DP, EMULATOR_ENV, True, True) == 0
    out = capsys.readouterr().out
    assert out.count("would run:") == 2 and "(dry run: no AWS)" in out


def test_drop_flow_noop_when_role_missing(monkeypatch, capsys):
    monkeypatch.setattr(role, "seeder_role_payload", lambda declaration, values, is_em: None)
    assert role.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 0
    assert "does not exist; nothing to drop" in capsys.readouterr().out


def test_drop_flow_emulator_never_prompts(monkeypatch, capsys):
    monkeypatch.setattr(
        role, "seeder_role_payload", lambda declaration, values, is_em: {"Role": {}}
    )

    def no_prompt(prompt=""):
        raise AssertionError("emulator plane must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    monkeypatch.setattr(role, "run_aws", lambda command, is_emulator, session=None: 0)
    assert role.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 0
    out = capsys.readouterr().out
    assert "detached: seeder-policy" in out
    assert f"deleted: {DP.seeder_role_name}" in out


def test_drop_flow_real_plane_runs_without_a_typed_barrier(monkeypatch, capsys):
    monkeypatch.setattr(
        role, "seeder_role_payload", lambda declaration, values, is_em: {"Role": {}}
    )

    def no_prompt(prompt=""):
        raise AssertionError("the drop flow must not prompt on the real plane")

    monkeypatch.setattr("builtins.input", no_prompt)
    monkeypatch.setattr(role, "run_aws", lambda command, is_emulator, session=None: 0)
    assert role.drop_seeder_flow(DP, REAL_ENV, False, False) == 0
    out = capsys.readouterr().out
    assert "detached: seeder-policy" in out
    assert f"deleted: {DP.seeder_role_name}" in out


def test_drop_flow_reports_policy_and_role_failures(monkeypatch, capsys):
    monkeypatch.setattr(
        role, "seeder_role_payload", lambda declaration, values, is_em: {"Role": {}}
    )
    codes = iter([1])
    monkeypatch.setattr(role, "run_aws", lambda command, is_emulator, session=None: next(codes))
    assert role.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 1
    assert "fix: detach seeder-policy" in capsys.readouterr().out

    codes = iter([0, 1])
    monkeypatch.setattr(role, "run_aws", lambda command, is_emulator, session=None: next(codes))
    assert role.drop_seeder_flow(DP, EMULATOR_ENV, True, False) == 1
    assert "fix: delete the role manually" in capsys.readouterr().out


def test_session_remaining_text_formats_and_tolerates_junk():
    future = {"expires_at": "2086-01-01T00:00:00Z"}
    assert session.session_remaining_text(future) != "??:??"
    assert session.session_remaining_text({}) == "??:??"
    assert session.session_remaining_text({"expires_at": "junk"}) == "??:??"


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
    assert session.cached_session(ROLE_ARN, cache) == payload


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
    assert session.cached_session(ROLE_ARN, cache) is None
    write({**base, "expires_at": "2020-01-01T00:00:00Z"})
    assert session.cached_session(ROLE_ARN, cache) is None
    near = (
        datetime.now(UTC) + timedelta(seconds=session.SESSION_RENEWAL_MARGIN_SECONDS - 60)
    ).isoformat()
    write({**base, "expires_at": near})
    assert session.cached_session(ROLE_ARN, cache) is None
    write(
        {key: value for key, value in base.items() if key != "session_token"}
        | {"expires_at": "2086-01-01T00:00:00Z"}
    )
    assert session.cached_session(ROLE_ARN, cache) is None
    cache.write_text("{not json")
    assert session.cached_session(ROLE_ARN, cache) is None
    assert session.cached_session(ROLE_ARN, tmp_path / "absent.json") is None


def test_save_cached_session_is_atomic_and_private(tmp_path):
    cache = tmp_path / "infra" / ".aws-session.json"
    triplet = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    session.save_cached_session(triplet, cache)
    assert json.loads(cache.read_text())["role_arn"] == ROLE_ARN
    assert cache.stat().st_mode & 0o777 == 0o600


def test_clear_cached_session_reports_idempotence(tmp_path):
    cache = tmp_path / "c.json"
    cache.write_text("{}")
    assert session.clear_cached_session(cache) is True
    assert session.clear_cached_session(cache) is False


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

    monkeypatch.setattr(session, "run_aws_captured", captured)
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    triplet = session.assume_seeder_session(
        ROLE_ARN, "arn:aws:iam::123456789012:mfa/kunalpisolkar", DP
    )
    assert triplet["access_key_id"] == "A" and triplet["role_arn"] == ROLE_ARN
    command = seen["command"]
    assert "--token-code" in command and "654321" in command
    assert "--serial-number" in command
    assert "--duration-seconds" in command and "43200" in command
    assert "--role-session-name" in command
    assert "carrier: assuming detectai-document-parser-seeder" in capsys.readouterr().out


def test_assume_rejects_non_numeric_codes(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda prompt="": "12a456")
    with pytest.raises(SystemExit) as excinfo:
        session.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1


def test_assume_failure_hints_at_the_trust_or_mfa(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    monkeypatch.setattr(
        session,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "AccessDenied"),
    )
    with pytest.raises(SystemExit) as excinfo:
        session.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1
    assert "trusts your caller" in capsys.readouterr().out


def test_assume_failure_hints_at_the_session_cap(monkeypatch, capsys):
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    stderr = "The requested DurationSeconds exceeds the MaxSessionDuration set for this role"
    monkeypatch.setattr(
        session, "run_aws_captured", lambda command, is_emulator, session=None: (1, "", stderr)
    )
    with pytest.raises(SystemExit):
        session.assume_seeder_session(ROLE_ARN, "serial", DP)
    out = capsys.readouterr().out
    assert "session cap" in out and "aws iam update-role" in out


def test_assume_rejects_a_foreign_identity(monkeypatch):
    payload = {
        "Credentials": {"AccessKeyId": "A", "SecretAccessKey": "B", "SessionToken": "C"},
        "AssumedRoleUser": {"Arn": "arn:aws:sts::123456789012:assumed-role/OtherRole/session"},
    }
    monkeypatch.setattr(
        session,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps(payload), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    with pytest.raises(SystemExit) as excinfo:
        session.assume_seeder_session(ROLE_ARN, "serial", DP)
    assert excinfo.value.code == 1


def test_assume_rejects_incomplete_credentials(monkeypatch):
    payload = {
        "Credentials": {},
        "AssumedRoleUser": {
            "Arn": f"arn:aws:sts::123456789012:assumed-role/{DP.seeder_role_name}/session"
        },
    }
    monkeypatch.setattr(
        session,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (0, json.dumps(payload), ""),
    )
    monkeypatch.setattr("builtins.input", lambda prompt="": "654321")
    with pytest.raises(SystemExit):
        session.assume_seeder_session(ROLE_ARN, "serial", DP)


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

    monkeypatch.setattr(session, "run_aws_captured", captured)

    def no_prompt(prompt=""):
        raise AssertionError("the emulator assume must not prompt")

    monkeypatch.setattr("builtins.input", no_prompt)
    triplet = session.assume_seeder_session(EMULATOR_ROLE_ARN, None, DP, True)
    assert triplet["access_key_id"] == "A" and triplet["role_arn"] == EMULATOR_ROLE_ARN
    assert "--token-code" not in seen["command"] and "--serial-number" not in seen["command"]
    assert seen["is_emulator"] is True
    assert "carrier: assuming detectai-document-parser-seeder" in capsys.readouterr().out


EMULATOR_TRUST_ARN = f"arn:aws:iam::000000000000:user/{DP.seeder_role_name}"
EMULATOR_ROLE_ARN = identity.seeder_role_arn(DP, "000000000000")


def emulator_trust(monkeypatch):
    monkeypatch.setattr(role, "resolve_trust_principal", lambda d, e: EMULATOR_TRUST_ARN)
    monkeypatch.setattr(session, "resolve_trust_principal", lambda d, e: EMULATOR_TRUST_ARN)


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
    assert (
        session.resolve_carrier_session(
            DP, EMULATOR_ENV, True, True, cache, secrets_policy.seeder_policy_document
        )
        is None
    )
    assert (
        session.resolve_carrier_session(
            DP, REAL_ENV, False, True, cache, secrets_policy.seeder_policy_document
        )
        is None
    )


def test_resolve_carrier_session_on_the_emulator_assumes_without_mfa(tmp_path, monkeypatch, capsys):
    emulator_trust(monkeypatch)
    healed = {}

    def fake_heal(declaration, values, is_emulator, *rest):
        healed["plane"] = is_emulator

    monkeypatch.setattr(session, "_ensure_seeder_role", fake_heal)
    seen = {}

    def fake_assume(role_arn, serial, declaration, is_emulator=False):
        seen["role_arn"] = role_arn
        seen["serial"] = serial
        seen["is_emulator"] = is_emulator
        return fresh_triplet()

    monkeypatch.setattr(session, "assume_seeder_session", fake_assume)
    cache = tmp_path / "c.json"
    assert (
        session.resolve_carrier_session(
            DP, EMULATOR_ENV, True, False, cache, secrets_policy.seeder_policy_document
        )
        == fresh_triplet()
    )
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
    healed = []

    def fake_heal(declaration, values, is_emulator, *rest):
        healed.append(is_emulator)

    monkeypatch.setattr(session, "_ensure_seeder_role", fake_heal)

    def boom(*arguments, **rest):
        raise AssertionError("a cached emulator session must not re-assume")

    monkeypatch.setattr(session, "assume_seeder_session", boom)
    assert (
        session.resolve_carrier_session(
            DP, EMULATOR_ENV, True, False, cache, secrets_policy.seeder_policy_document
        )
        == fresh_triplet()
    )
    assert healed == [True]


def test_resolve_carrier_session_on_real_aws_converges_and_assumes_with_mfa(
    tmp_path, monkeypatch, capsys
):
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    healed = {}

    def fake_heal(declaration, values, is_emulator, *rest):
        healed["plane"] = is_emulator

    monkeypatch.setattr(session, "_ensure_seeder_role", fake_heal)
    seen = {}

    def fake_assume(role_arn, serial, declaration, is_emulator=False):
        seen["role_arn"] = role_arn
        seen["serial"] = serial
        seen["is_emulator"] = is_emulator
        return fake_triplet(role_arn)

    monkeypatch.setattr(session, "assume_seeder_session", fake_assume)
    cache = tmp_path / "c.json"
    assert session.resolve_carrier_session(
        DP, REAL_ENV, False, False, cache, secrets_policy.seeder_policy_document
    ) == fake_triplet(ROLE_ARN)
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
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    healed = []

    def fake_heal(declaration, values, is_emulator, *rest):
        healed.append(is_emulator)

    monkeypatch.setattr(session, "_ensure_seeder_role", fake_heal)

    def boom(*arguments, **rest):
        raise AssertionError("a live cache must not prompt")

    monkeypatch.setattr(session, "assume_seeder_session", boom)
    assert (
        session.resolve_carrier_session(
            DP, REAL_ENV, False, False, cache, secrets_policy.seeder_policy_document
        )
        == payload
    )
    assert healed == [False]


def test_resolve_carrier_session_assumes_and_saves_when_uncached(tmp_path, monkeypatch):
    cache = tmp_path / "c.json"
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", USER_ARN))
    monkeypatch.setattr(
        session, "_ensure_seeder_role", lambda declaration, values, is_em, *rest: None
    )
    fresh = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    monkeypatch.setattr(
        session,
        "assume_seeder_session",
        lambda role_arn, serial, declaration, is_emulator: fresh,
    )
    assert (
        session.resolve_carrier_session(
            DP, REAL_ENV, False, False, cache, secrets_policy.seeder_policy_document
        )
        == fresh
    )
    assert json.loads(cache.read_text())["role_arn"] == ROLE_ARN


def test_resolve_carrier_session_dies_without_an_mfa_serial(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        policy,
        "sts_caller_identity",
        lambda: ("123456789012", "arn:aws:sts::123456789012:assumed-role/Ops/s"),
    )
    with pytest.raises(SystemExit) as excinfo:
        session.resolve_carrier_session(
            DP, REAL_ENV, False, False, tmp_path / "c", secrets_policy.seeder_policy_document
        )
    assert excinfo.value.code == 1
    out = capsys.readouterr().out
    assert "cannot derive" in out and "SEEDER_MFA_SERIAL" in out


# --- session-refresh-all: one assume batch behind one lazily entered MFA code ---


def toml_for(slug: str) -> str:
    return DP_TOML.replace("document-parser", slug)


def ready_workspace(tmp_path, slug: str, env_text: str) -> Workspace:
    service_dir = tmp_path / slug
    service_dir.mkdir()
    (service_dir / "secrets.toml").write_text(toml_for(slug))
    infra = service_dir / "infra"
    infra.mkdir()
    (infra / ".env").write_text(env_text)
    return workspace_for(KIND, service_dir)


def assume_payload(slug: str) -> dict:
    return {
        "Credentials": {
            "AccessKeyId": "A",
            "SecretAccessKey": "B",
            "SessionToken": "C",
            "Expiration": "2086-01-01T00:00:00Z",
        },
        "AssumedRoleUser": {
            "Arn": f"arn:aws:sts::123456789012:assumed-role/detectai-{slug}-seeder/batch"
        },
    }


def cached_triplet(slug: str) -> dict:
    return {
        "role_arn": f"arn:aws:iam::000000000000:role/detectai-{slug}-seeder",
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }


def real_plane_ident(monkeypatch):
    monkeypatch.setattr(policy, "sts_caller_identity", lambda: ("123456789012", USER_ARN))


def assume_slug_of(command) -> str:
    role_arn = command[command.index("--role-arn") + 1]
    return role_arn.split("detectai-")[1][: -len("-seeder")]


def test_refresh_all_runs_the_whole_batch_behind_one_mfa_code(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    real_plane_ident(monkeypatch)
    ensured: list[str] = []
    monkeypatch.setattr(batch, "_ensure_seeder_role", lambda d, v, e, *rest: ensured.append(d.slug))
    prompts: list[str] = []
    monkeypatch.setattr(batch, "prompt_mfa_code", lambda serial: prompts.append(serial) or "654321")
    tokens: dict[str, str] = {}

    def captured(command, is_emulator, session=None):
        slug = assume_slug_of(command)
        tokens[slug] = command[command.index("--token-code") + 1]
        return 0, json.dumps(assume_payload(slug)), ""

    monkeypatch.setattr(session, "run_aws_captured", captured)
    workspaces = [
        ready_workspace(tmp_path, "chats", render_env(REAL_ENV)),
        ready_workspace(tmp_path, "teams", render_env(REAL_ENV)),
    ]

    assert batch.refresh_all_flow(workspaces, False, False, False) == 0

    out = capsys.readouterr().out
    assert "refresh-all: 2 ready services on real AWS" in out
    assert prompts == ["arn:aws:iam::123456789012:mfa/kunalpisolkar"]  # one code, both assumes
    assert set(tokens.values()) == {"654321"}
    assert sorted(ensured) == ["chats", "teams"]  # both roles converge before the assume batch
    assert "refreshed: chats" in out and "refreshed: teams" in out
    assert "summary: 2 refreshed, 0 valid, 0 skipped, 0 failed" in out
    caches = sorted(path.name for path in (tmp_path / "cache").glob("*.json"))
    assert caches == ["chats.json", "teams.json"]


def test_refresh_all_prompts_again_for_a_second_mfa_device(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    real_plane_ident(monkeypatch)
    monkeypatch.setattr(batch, "_ensure_seeder_role", lambda d, v, e, *rest: None)
    prompts: list[str] = []

    def prompt(serial):
        prompts.append(serial)
        return "111111" if serial.endswith("alpha") else "222222"

    monkeypatch.setattr(batch, "prompt_mfa_code", prompt)
    tokens: dict[str, str] = {}

    def captured(command, is_emulator, session=None):
        slug = assume_slug_of(command)
        tokens[slug] = command[command.index("--token-code") + 1]
        return 0, json.dumps(assume_payload(slug)), ""

    monkeypatch.setattr(session, "run_aws_captured", captured)
    workspaces = [
        ready_workspace(
            tmp_path,
            "chats",
            render_env(
                {
                    "SEEDER_MFA_SERIAL": "arn:aws:iam::123456789012:mfa/alpha",
                    "API_KEY": "a" * 20,
                }
            ),
        ),
        ready_workspace(
            tmp_path,
            "teams",
            render_env(
                {
                    "SEEDER_MFA_SERIAL": "arn:aws:iam::123456789012:mfa/beta",
                    "API_KEY": "a" * 20,
                }
            ),
        ),
    ]

    assert batch.refresh_all_flow(workspaces, False, False, False) == 0

    assert prompts == [
        "arn:aws:iam::123456789012:mfa/alpha",
        "arn:aws:iam::123456789012:mfa/beta",
    ]  # each device is prompted lazily, in service order
    assert tokens == {"chats": "111111", "teams": "222222"}  # each device rides its own code


def test_refresh_all_retries_a_failed_assume_with_a_fresh_code(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    real_plane_ident(monkeypatch)
    monkeypatch.setattr(batch, "_ensure_seeder_role", lambda d, v, e, *rest: None)
    attempts: list[str] = []
    codes = iter(["111111", "222222"])

    def prompt(serial):
        return next(codes)

    monkeypatch.setattr(batch, "prompt_mfa_code", prompt)

    def captured(command, is_emulator, session=None):
        slug = assume_slug_of(command)
        attempts.append(f"{slug}:{command[command.index('--token-code') + 1]}")
        if len(attempts) == 1:
            return 1, "", "AccessDenied: the token rolled over"
        return 0, json.dumps(assume_payload(slug)), ""

    monkeypatch.setattr(session, "run_aws_captured", captured)
    workspaces = [ready_workspace(tmp_path, "chats", render_env(REAL_ENV))]

    assert batch.refresh_all_flow(workspaces, False, False, False) == 0

    assert attempts == ["chats:111111", "chats:222222"]  # exactly one fresh-code retry
    out = capsys.readouterr().out
    assert "note: re-assuming chats with a fresh MFA code" in out
    assert "refreshed: chats" in out
    assert "summary: 1 refreshed, 0 valid, 0 skipped, 0 failed" in out


def test_refresh_all_reports_a_failed_service_and_keeps_the_batch_going(
    monkeypatch, capsys, tmp_path
):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    real_plane_ident(monkeypatch)
    monkeypatch.setattr(batch, "_ensure_seeder_role", lambda d, v, e, *rest: None)
    codes = iter(["111111", "222222", "333333"])
    monkeypatch.setattr(batch, "prompt_mfa_code", lambda serial: next(codes))

    def captured(command, is_emulator, session=None):
        slug = assume_slug_of(command)
        if slug == "chats":
            return 1, "", "AccessDenied: the token rolled over again"
        return 0, json.dumps(assume_payload(slug)), ""

    monkeypatch.setattr(session, "run_aws_captured", captured)
    workspaces = [
        ready_workspace(tmp_path, "chats", render_env(REAL_ENV)),
        ready_workspace(tmp_path, "teams", render_env(REAL_ENV)),
    ]

    assert batch.refresh_all_flow(workspaces, False, False, False) == 1

    out = capsys.readouterr().out
    assert "failed: chats (see its assume error above)" in out
    assert "refreshed: teams" in out  # the failure does not stop the batch
    assert "summary: 1 refreshed, 0 valid, 0 skipped, 1 failed" in out
    assert (tmp_path / "cache" / "chats.json").exists() is False
    assert (tmp_path / "cache" / "teams.json").exists() is True


def test_refresh_all_dry_run_plans_without_converging_or_assuming(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    real_plane_ident(monkeypatch)

    def boom(*arguments, **rest):
        raise AssertionError("dry run must not converge a role or assume it")

    monkeypatch.setattr(batch, "_ensure_seeder_role", boom)
    monkeypatch.setattr(session, "run_aws_captured", boom)
    workspaces = [ready_workspace(tmp_path, "chats", render_env(REAL_ENV))]

    assert batch.refresh_all_flow(workspaces, False, False, True) == 0

    out = capsys.readouterr().out
    assert "would refresh: chats" in out
    assert "(dry run: no assumes, no MFA)" in out
    assert not (tmp_path / "cache" / "chats.json").exists()


def test_refresh_all_rides_a_still_valid_cached_triplet(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    cache = tmp_path / "cache" / "chats.json"
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps(cached_triplet("chats")))

    def boom(*arguments, **rest):
        raise AssertionError("a valid cached triplet must not converge or assume")

    monkeypatch.setattr(session, "run_aws_captured", boom)
    monkeypatch.setattr(batch, "_ensure_seeder_role", boom)
    workspaces = [ready_workspace(tmp_path, "chats", render_env(EMULATOR_ENV))]

    assert batch.refresh_all_flow(workspaces, True, False, False) == 0

    out = capsys.readouterr().out
    assert "valid: chats (cached triplet rides" in out
    assert "summary: 0 refreshed, 1 valid, 0 skipped, 0 failed" in out


def test_refresh_all_force_re_mints_a_valid_triplet(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    cache = tmp_path / "cache" / "chats.json"
    cache.parent.mkdir(parents=True)
    cache.write_text(json.dumps(cached_triplet("chats")))
    monkeypatch.setattr(batch, "_ensure_seeder_role", lambda d, v, e, *rest: None)

    def captured(command, is_emulator, session=None):
        return 0, json.dumps(assume_payload("chats")), ""

    monkeypatch.setattr(session, "run_aws_captured", captured)
    workspaces = [ready_workspace(tmp_path, "chats", render_env(EMULATOR_ENV))]

    assert batch.refresh_all_flow(workspaces, True, True, False) == 0

    out = capsys.readouterr().out
    assert "refreshed: chats" in out and "valid: chats" not in out


def test_refresh_all_skips_a_service_with_value_errors(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")

    def boom(*arguments, **rest):
        raise AssertionError("a skipped service must not converge or assume")

    monkeypatch.setattr(session, "run_aws_captured", boom)
    monkeypatch.setattr(batch, "_ensure_seeder_role", boom)
    workspaces = [ready_workspace(tmp_path, "chats", "API_KEY=abc\n")]

    assert batch.refresh_all_flow(workspaces, True, False, False) == 1

    out = capsys.readouterr().out
    assert "API_KEY missing or shorter than 16 chars" in out
    assert "skipped: chats (fix the value errors above)" in out


def test_refresh_all_reports_a_broken_declaration(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(session, "CACHE_ROOT", tmp_path / "cache")
    service_dir = tmp_path / "chats"
    service_dir.mkdir()
    (service_dir / "secrets.toml").write_text("[nonsense]\n")
    infra = service_dir / "infra"
    infra.mkdir()
    (infra / ".env").write_text(render_env(EMULATOR_ENV))

    assert batch.refresh_all_flow([workspace_for(KIND, service_dir)], True, False, False) == 1

    out = capsys.readouterr().out
    assert "failed: chats (see its declaration error above)" in out
    assert "summary: 0 refreshed, 0 valid, 0 skipped, 1 failed" in out


def test_refresh_all_without_candidates_hints_at_the_opt_in(capsys):
    assert batch.refresh_all_flow([], True, False, False) == 0
    out = capsys.readouterr().out
    assert "nothing to refresh" in out and "secrets.toml and infra/.env" in out
