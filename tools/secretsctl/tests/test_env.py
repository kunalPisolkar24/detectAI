"""Values-plane validation: env parsing, per-verb rules, notes, and shell conflicts."""

from __future__ import annotations

import pytest

from conftest import EMULATOR_ENV, REAL_ENV
from secretsctl import env
from secretsctl.env import BUCKET_SHAPE_ERROR

pytestmark = pytest.mark.unit


def test_parse_env_file_strips_comments_and_keeps_first_duplicate(tmp_path, capsys):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "A=one # inline comment\n" "# full comment line\n" "B= second \n" "A=two\n" "\n" "=oops\n"
    )
    assert env.parse_env_file(env_file) == {"A": "one", "B": "second"}
    captured = capsys.readouterr().out
    assert "duplicate A" in captured
    assert "empty key" in captured


def test_valid_common_checks(dp):
    assert env.validate(dp, EMULATOR_ENV, True) == []
    assert env.validate(dp, REAL_ENV, False) == []


def test_validate_rejects_short_api_key(dp):
    short = {**EMULATOR_ENV, "API_KEY": "short"}
    text = "\n".join(env.validate(dp, short, True))
    assert "API_KEY" in text and "16" in text and "fix:" in text


def test_validate_rejects_bad_region_and_env_type(dp):
    errors = "\n".join(
        env.validate(dp, {**EMULATOR_ENV, "AWS_REGION": "STATE-ONE", "ENV_TYPE": "staging"}, True)
    )
    assert "AWS_REGION" in errors and "ENV_TYPE" in errors


def test_validate_emulator_plane_rejects_bad_endpoint(dp):
    errors = "\n".join(
        env.validate(dp, {"API_KEY": "a" * 20, "EMULATOR_ENDPOINT": "localhost:4566"}, True)
    )
    assert "EMULATOR_ENDPOINT" in errors


def test_validate_rejects_an_endpoint_without_a_url_shape(dp):
    errors = env.validate(
        dp, {**EMULATOR_ENV, "OTEL_EXPORTER_OTLP_ENDPOINT": "localhost:4318"}, True
    )
    text = "\n".join(errors)
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" in text and "http(s)" in text and "fix:" in text


def test_validate_rejects_an_endpoint_without_a_license_key(dp):
    errors = env.validate(
        dp, {**EMULATOR_ENV, "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"}, True
    )
    text = "\n".join(errors)
    assert "NEW_RELIC_LICENSE_KEY" in text and "16" in text and "fix:" in text
    # The unset endpoint is the legitimate disabled stack: no key is demanded.
    assert env.validate(dp, EMULATOR_ENV, True) == []


def test_validate_accepts_a_set_endpoint_with_a_key_over_the_floor(dp):
    values = {
        **REAL_ENV,
        "OTEL_EXPORTER_OTLP_ENDPOINT": "https://otlp.nr-data.net",
        "NEW_RELIC_LICENSE_KEY": "d" * 20,
    }
    assert env.validate(dp, values, False) == []
    assert env.validate(dp, {**values, "EMULATOR_ENDPOINT": "http://localhost:4566"}, True) == []

    short = {**values, "NEW_RELIC_LICENSE_KEY": "d" * 8}
    assert "NEW_RELIC_LICENSE_KEY" in "\n".join(env.validate(dp, short, False))


def test_validate_real_plane_requires_bucket(dp):
    errors = "\n".join(env.validate(dp, {"API_KEY": "a" * 20}, False))
    assert "TF_STATE_BUCKET" in errors and "bootstrap" in errors


def test_validate_real_plane_rejects_bad_bucket_names(dp):
    for bucket in ("A" * 20, "ok-but-", "-nope", "a", "detectai.tier", "z" * 64):
        errors = "\n".join(env.validate(dp, {**REAL_ENV, "TF_STATE_BUCKET": bucket}, False))
        assert "TF_STATE_BUCKET" in errors, bucket


def test_bucket_shape_error_renders_the_offender():
    assert "Bad" in BUCKET_SHAPE_ERROR.format(bucket="Bad")


def test_validate_real_plane_accepts_valid_bucket_names(dp):
    assert env.validate(dp, {**REAL_ENV, "TF_STATE_BUCKET": "abc"}, False) == []
    assert env.validate(dp, {**REAL_ENV, "TF_STATE_BUCKET": "detectai-tfstate-123"}, False) == []


def test_validate_emulator_plane_rejects_bad_bucket_name(dp):
    errors = "\n".join(env.validate(dp, {**EMULATOR_ENV, "TF_STATE_BUCKET": "Bad_Bucket"}, True))
    assert "TF_STATE_BUCKET" in errors and "valid S3 bucket name" in errors


def test_validate_bootstrap_skips_key_and_env_type_checks(dp):
    assert env.validate_bootstrap(dp, {"EMULATOR_ENDPOINT": "http://localhost:4566"}, True) == []
    assert env.validate_bootstrap(dp, {"TF_STATE_BUCKET": "detectai-tfstate-sandbox"}, False) == []


def test_validate_bootstrap_keeps_bucket_region_and_endpoint_checks(dp):
    missing = "\n".join(env.validate_bootstrap(dp, {}, False))
    assert "TF_STATE_BUCKET" in missing

    bad_shape = "\n".join(
        env.validate_bootstrap(
            dp, {"EMULATOR_ENDPOINT": "http://localhost:4566", "TF_STATE_BUCKET": "Bad"}, True
        )
    )
    assert "valid S3 bucket name" in bad_shape

    bad_plane = "\n".join(
        env.validate_bootstrap(dp, {"EMULATOR_ENDPOINT": "nope", "AWS_REGION": "Mars-1"}, True)
    )
    assert "EMULATOR_ENDPOINT" in bad_plane and "AWS_REGION" in bad_plane


def test_resolve_state_bucket_defaults_and_overrides(dp):
    # Emulator: unset falls back to the declaration's emulator default; set passes through.
    assert env.resolve_state_bucket(dp, EMULATOR_ENV, True) == "detectai-docparser-tfstate"
    custom = env.resolve_state_bucket(
        dp, {**EMULATOR_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}, True
    )
    assert custom == "dp-tester-sandbox"
    # Real AWS: unset stays None (validation rejects it); set passes through.
    assert env.resolve_state_bucket(dp, {"API_KEY": "a" * 20}, False) is None
    assert env.resolve_state_bucket(dp, REAL_ENV, False) == "detectai-tfstate-sandbox"


def test_plane_notes_defaults_on_emulator_when_bucket_unset(dp):
    defaulting = "\n".join(env.plane_notes(dp, EMULATOR_ENV, "emulator (Floci)"))
    assert "defaults to detectai-docparser-tfstate" in defaulting
    custom = {**EMULATOR_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}
    assert all("defaults" not in note for note in env.plane_notes(dp, custom, "emulator (Floci)"))


def test_build_recovery_window_rules(dp):
    for raw in ("0", "7", "15", "30"):
        assert env.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": raw}, False) == []
    for raw in ("3", "31", "abc", "-5", "1.5"):
        errors = "\n".join(env.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": raw}, False))
        assert "SECRET_RECOVERY_WINDOW" in errors and "fix:" in errors, raw
    sentences = "\n".join(env.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "abc"}, False))
    assert "not a whole number" in sentences
    bounds = "\n".join(env.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "31"}, False))
    assert "between 7 and 30" in bounds
    # On the emulator the knob is out of contract: ignored, never rejected.
    assert env.validate(dp, {**EMULATOR_ENV, "SECRET_RECOVERY_WINDOW": "junk"}, True) == []


def test_plane_notes_recovery_window_messaging(dp):
    ignored = "\n".join(
        env.plane_notes(dp, {**EMULATOR_ENV, "SECRET_RECOVERY_WINDOW": "30"}, "emulator (Floci)")
    )
    assert "ignored on the emulator plane" in ignored
    zero_real = "\n".join(
        env.plane_notes(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "0"}, "real AWS")
    )
    assert "destroy deletes the secret immediately" in zero_real
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note
        for note in env.plane_notes(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "30"}, "real AWS")
    )
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note for note in env.plane_notes(dp, REAL_ENV, "real AWS")
    )


def test_warn_shell_conflicts_only_when_env_bucket_set(monkeypatch, capsys):
    monkeypatch.setenv("TF_STATE_BUCKET", "shell-bucket")
    env.warn_shell_conflicts(EMULATOR_ENV)  # .env bucket unset: nothing to conflict
    assert capsys.readouterr().out == ""
    env.warn_shell_conflicts({**EMULATOR_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"})
    assert "the .env value wins" in capsys.readouterr().out
