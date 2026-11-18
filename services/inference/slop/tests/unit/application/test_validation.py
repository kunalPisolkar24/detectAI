import unicodedata

import pytest

from src.application.services.validation import InputValidator
from src.domain.exceptions import InvalidInputError


def test_validate_rejects_non_string_and_blank():
    validator = InputValidator(100)

    with pytest.raises(InvalidInputError):
        validator.validate(123)
    with pytest.raises(InvalidInputError):
        validator.validate("")
    with pytest.raises(InvalidInputError):
        validator.validate("   ")


def test_validate_rejects_control_only_input():
    with pytest.raises(InvalidInputError, match="only control characters"):
        InputValidator(100).validate("\x00\x07\x7f \t\n")


def test_validate_rejects_overlong_input():
    with pytest.raises(InvalidInputError, match="maximum length"):
        InputValidator(4).validate("abcde")


def test_validate_preserves_word_boundaries():
    assert InputValidator(100).validate("hello\nworld") == "hello world"
    assert InputValidator(100).validate("a\x00b\x7fc\x85d\x9fe") == "a b c d e"


def test_validate_keeps_non_control_characters():
    text = "caf\u00e9 \u200d end"
    assert InputValidator(100).validate(text) == text


def test_validate_keeps_astral_characters():
    text = "rocket \U0001f680 done"
    assert InputValidator(100).validate(text) == text


def test_sanitize_matches_category_check_across_bmp():
    validator = InputValidator(0x20000)
    for code in range(0x10000):
        ch = chr(code)
        expected = " " if unicodedata.category(ch) == "Cc" else ch
        assert validator.validate("a" + ch + "b") == "a" + expected + "b"


def test_sanitize_matches_category_check_on_samples():
    validator = InputValidator(1000)
    samples = [
        "plain text",
        "tab\there newline\nhere",
        "null\x00null",
        "mix\x00\t\n\r\x7f\x80\x9fend",
    ]
    for text in samples:
        expected = "".join(" " if unicodedata.category(ch) == "Cc" else ch for ch in text).strip()
        assert validator.validate(text) == expected
