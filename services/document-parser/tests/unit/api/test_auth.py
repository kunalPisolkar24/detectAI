"""Pure contract of the verify function — no HTTP, no app, no boot.

Everything wire-shaped (status codes, bodies, headers) lives in the
integration suite; these cases pin the comparison semantics itself.
"""

from app.api.auth import credential_matches

_KEY = "unit-test-key-000001"


def test_equal_keys_match() -> None:
    assert credential_matches(_KEY, _KEY) is True


def test_missing_candidate_is_a_mismatch() -> None:
    assert credential_matches(_KEY, None) is False


def test_tampered_candidate_is_a_mismatch() -> None:
    assert credential_matches(_KEY, _KEY + "x") is False
    assert credential_matches(_KEY, _KEY[:-1]) is False


def test_empty_and_whitespace_candidates_are_mismatches() -> None:
    assert credential_matches(_KEY, "") is False
    assert credential_matches(_KEY, f" {_KEY} ") is False


def test_non_ascii_candidate_degrades_to_a_mismatch() -> None:
    # UTF-8 encodable accents must compare, not crash.
    assert credential_matches(_KEY, "clé-café-âñde-0001") is False


def test_lone_surrogate_degrades_to_a_mismatch() -> None:
    # A direct caller can hand us a str the wire could never carry; the
    # contract is a plain False, never an encode error.
    assert credential_matches(_KEY, "\ud800") is False
