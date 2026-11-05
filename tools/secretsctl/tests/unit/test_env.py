"""Values-plane validation: env parsing, per-verb rules, and plane notes."""

from __future__ import annotations

import pytest

from conftest import EMULATOR_ENV, REAL_ENV
from app.declaration.model import state_bucket_for
from app.values import parse, plane, rules

pytestmark = pytest.mark.unit


def test_parse_env_file_strips_comments_and_keeps_first_duplicate(tmp_path, capsys):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "A=one # inline comment\n" "# full comment line\n" "B= second \n" "A=two\n" "\n" "=oops\n"
    )
    assert parse.parse_env_file(env_file) == {"A": "one", "B": "second"}
    captured = capsys.readouterr().out
    assert "duplicate A" in captured
    assert "empty key" in captured


def test_valid_common_checks(dp):
    assert rules.validate(dp, EMULATOR_ENV, True) == []
    assert rules.validate(dp, REAL_ENV, False) == []


def test_validate_rejects_short_api_key(dp):
    short = {**EMULATOR_ENV, "API_KEY": "short"}
    text = "\n".join(rules.validate(dp, short, True))
    assert "API_KEY" in text and "16" in text and "fix:" in text


def test_validate_rejects_bad_region_and_env_type(dp):
    errors = "\n".join(
        rules.validate(dp, {**EMULATOR_ENV, "AWS_REGION": "STATE-ONE", "ENV_TYPE": "staging"}, True)
    )
    assert "AWS_REGION" in errors and "ENV_TYPE" in errors


def test_validate_rejects_an_endpoint_without_a_url_shape(dp):
    errors = rules.validate(
        dp, {**EMULATOR_ENV, "OTEL_EXPORTER_OTLP_ENDPOINT": "localhost:4318"}, True
    )
    text = "\n".join(errors)
    assert "OTEL_EXPORTER_OTLP_ENDPOINT" in text and "http(s)" in text and "fix:" in text


def test_validate_rejects_an_endpoint_without_a_license_key(dp):
    errors = rules.validate(
        dp, {**EMULATOR_ENV, "OTEL_EXPORTER_OTLP_ENDPOINT": "http://localhost:4318"}, True
    )
    text = "\n".join(errors)
    assert "NEW_RELIC_LICENSE_KEY" in text and "16" in text and "fix:" in text
    # The unset endpoint is the legitimate disabled stack: no key is demanded.
    assert rules.validate(dp, EMULATOR_ENV, True) == []


def test_validate_accepts_a_set_endpoint_with_a_key_over_the_floor(dp):
    values = {
        **REAL_ENV,
        "OTEL_EXPORTER_OTLP_ENDPOINT": "https://otlp.nr-data.net",
        "NEW_RELIC_LICENSE_KEY": "d" * 20,
    }
    assert rules.validate(dp, values, False) == []
    assert rules.validate(dp, values, True) == []

    short = {**values, "NEW_RELIC_LICENSE_KEY": "d" * 8}
    assert "NEW_RELIC_LICENSE_KEY" in "\n".join(rules.validate(dp, short, False))


def test_tf_state_bucket_is_not_a_concept_anywhere(dp):
    """A stray TF_STATE_BUCKET line is inert: no override, no note, no error
    — the derived bucket wins on every plane."""
    stray = {**EMULATOR_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}
    assert rules.validate(dp, stray, True) == []
    assert rules.validate(dp, {**REAL_ENV, "TF_STATE_BUCKET": "dp-tester-sandbox"}, False) == []
    for note in plane.plane_notes(dp, stray, True):
        assert "TF_STATE_BUCKET" not in note


def test_the_state_bucket_is_always_derived_from_slug_and_account(dp):
    assert state_bucket_for(dp.slug, "000000000000") == (
        "detectai-document-parser-tfstate-000000000000"
    )
    assert state_bucket_for(dp.slug, "123456789012") == (
        "detectai-document-parser-tfstate-123456789012"
    )


def test_an_empty_region_line_reads_as_unset():
    values = {key: value for key, value in EMULATOR_ENV.items() if key != "AWS_REGION"}
    assert rules.plane_errors({**values, "AWS_REGION": ""}) == []


def test_resolve_floci_url_overrides_from_the_environment(monkeypatch):
    monkeypatch.setenv("SECRETSCTL_FLOCI_URL", "http://localhost:9999")
    assert plane.resolve_floci_url() == "http://localhost:9999"
    assert "floci (emulator http://localhost:9999)" in plane.plane_display(True)
    monkeypatch.delenv("SECRETSCTL_FLOCI_URL")
    assert plane.resolve_floci_url() == plane.DEFAULT_FLOCI_URL


def test_build_recovery_window_rules(dp):
    for raw in ("0", "7", "15", "30"):
        assert rules.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": raw}, False) == []
    for raw in ("3", "31", "abc", "-5", "1.5"):
        errors = "\n".join(rules.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": raw}, False))
        assert "SECRET_RECOVERY_WINDOW" in errors and "fix:" in errors, raw
    sentences = "\n".join(rules.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "abc"}, False))
    assert "not a whole number" in sentences
    bounds = "\n".join(rules.validate(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "31"}, False))
    assert "between 7 and 30" in bounds
    # On the emulator the knob is out of contract: ignored, never rejected.
    assert rules.validate(dp, {**EMULATOR_ENV, "SECRET_RECOVERY_WINDOW": "junk"}, True) == []


def test_plane_notes_recovery_window_messaging(dp):
    ignored = "\n".join(plane.plane_notes(dp, {**EMULATOR_ENV, "SECRET_RECOVERY_WINDOW": "30"}, True))
    assert "ignored on the emulator plane" in ignored
    zero_real = "\n".join(plane.plane_notes(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "0"}, False))
    assert "destroy deletes the secret immediately" in zero_real
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note
        for note in plane.plane_notes(dp, {**REAL_ENV, "SECRET_RECOVERY_WINDOW": "30"}, False)
    )
    assert all(
        "SECRET_RECOVERY_WINDOW" not in note for note in plane.plane_notes(dp, REAL_ENV, False)
    )
