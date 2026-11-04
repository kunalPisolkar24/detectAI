"""Verify verb: fingerprints, seed comparison, collectors, and the flow's verdicts."""

from __future__ import annotations

import json

import pytest

from conftest import EMULATOR_ENV, REAL_ENV, ROLE_ARN
from secretsctl import verify

pytestmark = pytest.mark.unit


def test_fingerprint_is_stable_short_and_value_hiding():
    fingerprint = verify.fingerprint("a" * 20)
    assert fingerprint == verify.fingerprint("a" * 20)
    assert len(fingerprint) == 12
    assert fingerprint != verify.fingerprint("b" * 20)
    assert "a" * 20 not in fingerprint


def test_expected_seeds_filter_to_the_nonempty_allowlist(dp):
    values = {"API_KEY": "a" * 20, "NEW_RELIC_LICENSE_KEY": "", "OTEL_TRACE_SAMPLE_RATIO": "0.5"}
    assert verify.expected_blob(dp, values) == {"API_KEY": "a" * 20}
    assert verify.expected_ssm_seeds(dp, values) == {"OTEL_TRACE_SAMPLE_RATIO": "0.5"}


def test_compare_seeds_splits_matched_mismatched_missing():
    expected = {"A": "1", "B": "2", "C": "3"}
    live = {"A": "1", "B": "9", "D": "4"}
    matched, mismatched, missing = verify.compare_seeds(expected, live)
    assert matched == ["A"]
    assert mismatched == ["B"]
    assert missing == ["C"]


def test_verify_commands_shape(dp):
    commands = verify.verify_commands(dp, EMULATOR_ENV, True)
    assert len(commands) == 3
    assert "--path /detectai/document-parser/" in " ".join(commands[0])
    assert "--secret-id detectai/document-parser/secrets" in " ".join(commands[1])
    assert "get-secret-value" in " ".join(commands[2])


def test_collect_ssm_parameters_paginates(dp, monkeypatch):
    pages = [
        {
            "Parameters": [{"Name": "/detectai/document-parser/A", "Type": "String", "Value": "1"}],
            "NextToken": "t",
        },
        {
            "Parameters": [
                {"Name": "/detectai/document-parser/B", "Type": "SecureString", "Value": "2"}
            ],
        },
    ]
    calls = []

    def captured(command, is_emulator, session=None):
        calls.append(command)
        return 0, json.dumps(pages[len(calls) - 1]), ""

    monkeypatch.setattr(verify, "run_aws_captured", captured)
    live = verify.collect_ssm_parameters(dp, EMULATOR_ENV, True)
    assert live == {
        "/detectai/document-parser/A": {"type": "String", "value": "1"},
        "/detectai/document-parser/B": {"type": "SecureString", "value": "2"},
    }
    assert "--next-token t" in " ".join(calls[1])


def test_collect_ssm_parameters_reports_failures(dp, monkeypatch, capsys):
    monkeypatch.setattr(
        verify, "run_aws_captured", lambda command, is_emulator, session=None: (1, "", "boom")
    )
    assert verify.collect_ssm_parameters(dp, EMULATOR_ENV, True) is None
    assert "could not list parameters" in capsys.readouterr().out

    monkeypatch.setattr(
        verify, "run_aws_captured", lambda command, is_emulator, session=None: (0, "{bad", "")
    )
    assert verify.collect_ssm_parameters(dp, EMULATOR_ENV, True) is None
    assert "unparseable" in capsys.readouterr().out


def test_collect_secret_handles_the_read_ladder(dp, monkeypatch):
    described = {"Name": dp.secret_name, "ARN": "arn:aws:secretsmanager:zone:1:secret:x"}

    def captured_factory(
        describe_code, describe_out, describe_err, value_code, value_out, value_err
    ):
        calls = []

        def captured(command, is_emulator, session=None):
            calls.append(command)
            if "describe-secret" in command:
                return describe_code, describe_out, describe_err
            return value_code, value_out, value_err

        return captured, calls

    captured, _ = captured_factory(
        0,
        json.dumps(described),
        "",
        0,
        json.dumps({"SecretString": json.dumps({"API_KEY": "a" * 20})}),
        "",
    )
    monkeypatch.setattr(verify, "run_aws_captured", captured)
    assert verify.collect_secret(dp, EMULATOR_ENV, True) == (described, {"API_KEY": "a" * 20})

    captured, _ = captured_factory(1, "", "ResourceNotFoundException", 0, "", "")
    monkeypatch.setattr(verify, "run_aws_captured", captured)
    assert verify.collect_secret(dp, EMULATOR_ENV, True) == (None, None)

    captured, _ = captured_factory(0, json.dumps(described), "", 1, "", "ResourceNotFoundException")
    monkeypatch.setattr(verify, "run_aws_captured", captured)
    assert verify.collect_secret(dp, EMULATOR_ENV, True) == (described, None)

    captured, _ = captured_factory(
        0, json.dumps(described), "", 0, json.dumps({"SecretString": "{bad"}), ""
    )
    monkeypatch.setattr(verify, "run_aws_captured", captured)
    live_described, stored = verify.collect_secret(dp, EMULATOR_ENV, True)
    assert live_described == described and stored is None

    captured, _ = captured_factory(1, "", "AccessDenied", 0, "", "")
    monkeypatch.setattr(verify, "run_aws_captured", captured)
    assert verify.collect_secret(dp, EMULATOR_ENV, True) == (None, None)


def test_collect_secret_reports_a_missing_secret_with_the_apply_hint(dp, monkeypatch, capsys):
    monkeypatch.setattr(
        verify,
        "run_aws_captured",
        lambda command, is_emulator, session=None: (1, "", "ResourceNotFoundException"),
    )
    assert verify.collect_secret(dp, EMULATOR_ENV, True) == (None, None)
    assert "run the apply verb" in capsys.readouterr().out


def test_verify_flow_dry_run(dp, monkeypatch, capsys):
    def boom(*arguments, **rest):
        raise AssertionError("dry run must not touch AWS")

    monkeypatch.setattr(verify, "run_aws_captured", boom)
    assert verify.verify_flow(dp, EMULATOR_ENV, True, True) == 0
    out = capsys.readouterr().out
    assert out.count("would run:") == 3 and "(dry run: no AWS)" in out


def test_verify_flow_happy_path(dp, monkeypatch, capsys):
    monkeypatch.setattr(
        verify, "collect_ssm_parameters", lambda declaration, values, is_emulator, session=None: {}
    )
    monkeypatch.setattr(
        verify,
        "collect_secret",
        lambda declaration, values, is_emulator, session=None: (
            {"Name": dp.secret_name},
            {"API_KEY": "a" * 20},
        ),
    )
    session = {
        "role_arn": "arn:aws:iam::000000000000:role/detectai-document-parser-seeder",
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    assert verify.verify_flow(dp, EMULATOR_ENV, True, False, session) == 0
    out = capsys.readouterr().out
    assert "ok:      the seeded plane matches the .env values" in out
    assert "carrier: role session (detectai-document-parser-seeder, valid " in out
    assert f"secret:  {dp.secret_name}" in out
    assert f"ssm:     {dp.ssm_prefix}" in out


def test_verify_flow_reports_ssm_and_blob_drift(dp, monkeypatch, capsys):
    values = {**EMULATOR_ENV, "OTEL_TRACE_SAMPLE_RATIO": "0.5"}
    monkeypatch.setattr(
        verify,
        "collect_ssm_parameters",
        lambda declaration, values, is_emulator, session=None: {
            "/detectai/document-parser/OTEL_TRACE_SAMPLE_RATIO": {
                "type": "String",
                "value": "0.9",
            }
        },
    )
    monkeypatch.setattr(
        verify,
        "collect_secret",
        lambda declaration, values, is_emulator, session=None: (
            {"Name": dp.secret_name},
            {"API_KEY": "b" * 20},
        ),
    )
    assert verify.verify_flow(dp, values, True, False) == 1
    out = capsys.readouterr().out
    assert "problem: /detectai/document-parser/OTEL_TRACE_SAMPLE_RATIO does not match .env" in out
    assert "problem: API_KEY does not match .env" in out
    assert "fail:    the seeded plane does not match the .env values" in out


def test_verify_flow_reports_missing_and_extra(dp, monkeypatch, capsys):
    values = {**EMULATOR_ENV, "OTEL_TRACE_SAMPLE_RATIO": "0.5"}
    monkeypatch.setattr(
        verify, "collect_ssm_parameters", lambda declaration, values, is_emulator, session=None: {}
    )
    monkeypatch.setattr(
        verify,
        "collect_secret",
        lambda declaration, values, is_emulator, session=None: (
            {"Name": dp.secret_name},
            {"API_KEY": "a" * 20, "EXTRA": "x"},
        ),
    )
    assert verify.verify_flow(dp, values, True, False) == 1
    out = capsys.readouterr().out
    assert "missing (expected from .env)" in out
    assert "note:   EXTRA is on the plane outside the .env seed list" in out


def test_verify_flow_flags_a_pending_deletion(dp, monkeypatch, capsys):
    monkeypatch.setattr(
        verify, "collect_ssm_parameters", lambda declaration, values, is_emulator, session=None: {}
    )
    described = {
        "Name": dp.secret_name,
        "DeletedDate": "2026-01-01T00:00:00Z",
        "RecoveryWindowInDays": 7,
    }
    monkeypatch.setattr(
        verify,
        "collect_secret",
        lambda declaration, values, is_emulator, session=None: (described, None),
    )
    assert verify.verify_flow(dp, EMULATOR_ENV, True, False) == 1
    out = capsys.readouterr().out
    assert "scheduled for deletion" in out
    assert "(no stored version)" in out
    assert "the blob holds no version" in out


def test_verify_flow_carries_the_session_banner(dp, monkeypatch, capsys):
    session = {
        "role_arn": ROLE_ARN,
        "access_key_id": "A",
        "secret_access_key": "B",
        "session_token": "C",
        "expires_at": "2086-01-01T00:00:00Z",
    }
    monkeypatch.setattr(
        verify, "collect_ssm_parameters", lambda declaration, values, is_emulator, session=None: {}
    )
    monkeypatch.setattr(
        verify,
        "collect_secret",
        lambda declaration, values, is_emulator, session=None: (
            {"Name": dp.secret_name},
            {"API_KEY": "a" * 20},
        ),
    )
    assert verify.verify_flow(dp, REAL_ENV, False, False, session) == 0
    out = capsys.readouterr().out
    assert "carrier: role session (detectai-document-parser-seeder, valid " in out
