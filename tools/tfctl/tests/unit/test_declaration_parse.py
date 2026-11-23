"""Declaration parsing: native TOML comments and commented-out table blocks."""

from __future__ import annotations

import tomllib

import pytest

from app.engine.declaration.parse import _active_text, parse_declaration

pytestmark = pytest.mark.unit


def test_native_line_comments_still_work(tmp_path):
    toml = tmp_path / "declaration.toml"
    toml.write_text(
        '# a note\n[service]\nslug = "infra" # trailing note\n\n'
        '# name = "disabled"\nregion = "ap-southeast-2"\n'
    )
    assert parse_declaration(toml) == {"service": {"slug": "infra", "region": "ap-southeast-2"}}


def test_commented_header_drops_the_whole_block(tmp_path):
    toml = tmp_path / "infra.toml"
    toml.write_text(
        '[service]\nslug = "infra"\n\n'
        '[[queues]]\nname = "a.fifo"\n\n'
        '# [[queues]]\nname = "b.fifo"\nmax_receive_count = 5\n\n'
        '[[elasticache]]\nname = "cache"\n'
    )
    assert parse_declaration(toml) == {
        "service": {"slug": "infra"},
        "queues": [{"name": "a.fifo"}],
        "elasticache": [{"name": "cache"}],
    }


def test_several_commented_blocks_and_a_following_active_one(tmp_path):
    toml = tmp_path / "secrets.toml"
    toml.write_text(
        '[service]\nslug = "chats"\n\n'
        '[secrets]\nkeys = ["API_KEY"]\n\n'
        "# [secrets.min_lengths]\nAPI_KEY = 16\n\n"
        '# [ssm]\nkeys = [\n    "PORT",\n    "MAX_PDF_PAGES",\n]\n\n'
        '[requires]\n"PORT" = ["API_KEY", 16]\n'
    )
    assert parse_declaration(toml) == {
        "service": {"slug": "chats"},
        "secrets": {"keys": ["API_KEY"]},
        "requires": {"PORT": ["API_KEY", 16]},
    }


def test_indented_header_with_trailing_comment_is_disabled(tmp_path):
    toml = tmp_path / "infra.toml"
    toml.write_text(
        '[service]\nslug = "infra"\n\n'
        "   # [[atlas]] # local runs do not need Atlas\n"
        'name = "detectai-dev-mongo"\nregion = "AP_SOUTHEAST_2"\n\n'
        '[[queues]]\nname = "a.fifo"\n'
    )
    assert parse_declaration(toml) == {
        "service": {"slug": "infra"},
        "queues": [{"name": "a.fifo"}],
    }


def test_prose_comment_naming_a_header_is_not_a_disable(tmp_path):
    toml = tmp_path / "infra.toml"
    toml.write_text(
        '[service]\nslug = "infra"\n\n'
        "# the [[queues]] ledger holds the SQS fabrics\n"
        '[[queues]]\nname = "a.fifo"\n'
    )
    assert parse_declaration(toml) == {
        "service": {"slug": "infra"},
        "queues": [{"name": "a.fifo"}],
    }


def test_nested_array_line_is_not_mistaken_for_a_header(tmp_path):
    toml = tmp_path / "declaration.toml"
    toml.write_text(
        '[service]\nslug = "infra"\n\n'
        '# [disabled]\npairs = [\n  ["a", "b"],\n]\n\n'
        "[kept]\nvalue = 1\n"
    )
    assert parse_declaration(toml) == {
        "service": {"slug": "infra"},
        "kept": {"value": 1},
    }


def test_disabled_lines_are_blanked_not_removed():
    text = '[service]\n# [old]\nslug = "infra"\r\n'
    assert _active_text(text) == "[service]\n\n\r\n"


def test_final_disabled_line_without_a_newline():
    assert _active_text('[service]\n# [old]\nname = "x"') == "[service]\n\n"


def test_malformed_toml_still_raises_decode_error(tmp_path):
    toml = tmp_path / "infra.toml"
    toml.write_text('[service\nslug = "infra"\n')
    with pytest.raises(tomllib.TOMLDecodeError):
        parse_declaration(toml)


def test_decode_error_line_numbers_still_match_the_file():
    text = '# [disabled]\nname = "x"\n[service]\nslug = "infra\n'
    with pytest.raises(tomllib.TOMLDecodeError) as excinfo:
        tomllib.loads(_active_text(text))
    assert "at line 4" in str(excinfo.value)
