"""Values-plane validation: env parsing, per-verb rules, and plane notes."""

from __future__ import annotations

import pytest

from conftest import EMULATOR_ENV, REAL_ENV
from app import config
from app import env

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
    assert env.validate(dp, values, True) == []

    short = {**values, "NEW_RELIC_LICENSE_KEY": "d" * 8}
    assert "NEW_RELIC_LICENSE_KEY" in "\n".join(env.validate(dp, short, False))


def test_tf_state_bucket_is_not_a_concept_anywhere(dp):
    """A stray TF_STATE_BUCKET line is inert: no override, no note, no error
    — the derived bucket wins on every plane."""
    stray = {**EMULATOR_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}
    assert env.validate(dp, stray, True) == []
    assert env.validate(dp, {**REAL_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}, False) == []
    for note in env.plane_notes(dp, stray, True):
        assert "TF_STATE_BUCKET" not in note


def test_the_state_bucket_is_always_derived_from_slug_and_account(dp):
    assert config.state_bucket_for(dp.slug, "000000000000") == (
        "detectai-document-parser-tfstate-000000000000"
    )
    assert config.state_bucket_for(dp.slug, "123456789012") == (
        "detectai-document-parser-tfstate-123456789012"
    )


def test_resolve_plane_follows_the_flag_and_defaults_to_floci(monkeypatch):
    monkeypatch.delenv("SECRETSCTL_FLOCI_URL", raising=False)
    plane, is_emulator = env.resolve_plane(False)
    assert plane == "floci (emulator http://localhost:4566)" and is_emulator

    plane, is_emulator = env.resolve_plane(True)
    assert plane == "real AWS" and not is_emulator


def test_resolve_floci_url_overrides_from_the_environment(monkeypatch):
    monkeypatch.setenv("SECRETSCTL_FLOCI_URL", "http://localhost:9999")
    assert env.resolve_floci_url() == "http://localhost:9999"
    assert "floci (emulator http://localhost:9999)" in env.plane_display(True)
    monkeypatch.delenv("SECRETSCTL_FLOCI_URL")
    assert env.resolve_floci_url() == env.DEFAULT_FLOCI_URL


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
    ignored = "\n".join(env.plane_notes(dp, {**EMULATOR_ENV, "SECRET_RECOVERY_WINDOW": "30"}, True))
    assert "ignored on the emulator plane" in ignored
    zero_real = "\n".join(env.plane_notes(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "0"}, False))
    assert "destroy deletes the secret immediately" in zero_real
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note
        for note in env.plane_notes(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "30"}, False)
    )
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note for note in env.plane_notes(dp, REAL_ENV, False)
    )
