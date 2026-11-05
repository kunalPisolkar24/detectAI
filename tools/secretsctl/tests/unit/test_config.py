"""Declaration loading: schema errors, name derivation, and workspace layout."""

from __future__ import annotations

import tomllib

import pytest

from conftest import DP, DP_TOML
from app.declaration.loader import DeclarationError, load
from app.declaration.locate import workspace_for
from app.declaration.model import (
    DEFAULT_RECOVERY_WINDOW,
    DEFAULT_REGION,
    state_bucket_for,
)
from app.stack.inputs import PLANE_ROOT

pytestmark = pytest.mark.unit


def test_document_parser_declaration_matches_the_committed_schema(tmp_path):
    toml = tmp_path / "secrets.toml"
    toml.write_text(DP_TOML)
    assert load(toml) == DP


def test_derived_names_use_the_slug(tmp_path):
    toml = tmp_path / "secrets.toml"
    toml.write_text('[service]\nslug = "chats"\n\n[secrets]\nkeys = ["API_KEY"]\n')
    declaration = load(toml)
    assert declaration.secret_name == "detectai/chats/secrets"
    assert declaration.ssm_prefix == "/detectai/chats/"
    assert declaration.seeder_role_name == "detectai-chats-seeder"
    assert state_bucket_for(declaration.slug, "123456789012") == (
        "detectai-chats-tfstate-123456789012"
    )
    assert declaration.blob_keys == ("API_KEY",)
    assert declaration.ssm_keys == ()
    assert declaration.min_lengths == {}
    assert declaration.requires == {}
    assert declaration.region_default == DEFAULT_REGION
    assert declaration.recovery_window == DEFAULT_RECOVERY_WINDOW


def test_the_state_table_is_retired_not_honored(tmp_path):
    toml = tmp_path / "secrets.toml"
    toml.write_text(
        '[service]\nslug = "chats"\n\n[state]\nemulator_default = "detectai-test-state"\n'
        '\n[secrets]\nkeys = ["API_KEY"]\n'
    )
    with pytest.raises(DeclarationError) as excinfo:
        load(toml)
    assert "unknown section(s) ['state']" in str(excinfo.value)


def test_defaults_are_taken_from_the_declaration(tmp_path):
    toml = tmp_path / "secrets.toml"
    toml.write_text(
        '[service]\nslug = "chats"\nregion = "us-east-1"\nrecovery_window = 14\n'
        '\n[secrets]\nkeys = ["API_KEY"]\n'
    )
    declaration = load(toml)
    assert declaration.region_default == "us-east-1"
    assert declaration.recovery_window == 14


@pytest.mark.parametrize(
    "text",
    [
        '[secrets]\nkeys = ["A"]\n',  # no [service]
        '[service]\nslug = "Upper"\n[secrets]\nkeys = ["A"]\n',  # bad slug
        '[service]\nslug="x"\nregion = "Mars-1"\n[secrets]\nkeys=["A"]\n',  # bad region
        '[service]\nslug = "x"\nrecovery_window = 31\n[secrets]\nkeys = ["A"]\n',  # bounds
        '[service]\nslug = "x"\nrecovery_window = 3\n[secrets]\nkeys = ["A"]\n',
        '[service]\nslug = "x"\nemulator_default = "A_B"\n[secrets]\nkeys = ["A"]\n',  # unknown service field
        f'[service]\nslug = "{"a" * 35}"\n\n[secrets]\nkeys = ["A"]\n',  # slug blows the bucket-name ceiling
        '[service]\nslug = "x"\n\n[secrets]\nkeys = []\n',  # empty blob keys
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["a-b"]\n',  # bad key shape
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A", "A"]\n',  # duplicate
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\nmin_lengths = {B = 16}\n',  # unknown min key
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\nmin_lengths = {A = 0}\n',
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\n\n[ssm]\nkeys = ["A"]\n',  # both planes
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\n\n[requires]\n"A" = ["B", 16]\n',  # pairs off-plane
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\n\n[requires]\n"X" = ["A", 16]\n',  # trigger never seeded
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\n\n[requires]\n"A" = ["A", 0]\n',  # bad floor
        '[service]\nslug = "x"\n\n[nonsense]\n',  # unknown section
    ],
)
def test_schema_errors_are_reported_with_the_field(tmp_path, text):
    toml = tmp_path / "secrets.toml"
    toml.write_text(text)
    with pytest.raises(DeclarationError) as excinfo:
        load(toml)
    assert "secrets.toml" in str(excinfo.value)


@pytest.mark.parametrize(
    "text",
    [
        'ssm = "junk"\n[service]\nslug = "x"\n\n[secrets]\nkeys = ["A"]\n',
        "requires = 3\n[service]\nslug = \"x\"\n\n[secrets]\nkeys = [\"A\"]\n",
        'secrets = "junk"\n[service]\nslug = "x"\n',
    ],
)
def test_non_table_sections_fail_cleanly(tmp_path, text):
    toml = tmp_path / "secrets.toml"
    toml.write_text(text)
    with pytest.raises(DeclarationError) as excinfo:
        load(toml)
    assert "must be a table" in str(excinfo.value)


@pytest.mark.parametrize("text", ['[service]\nslug = "x"\n', ""])
def test_unreadable_or_incomplete_toml_raises(tmp_path, text):
    toml = tmp_path / "secrets.toml"
    if text:
        toml.write_text(text)
    with pytest.raises(DeclarationError):
        load(tmp_path / "does-not-exist.toml")
    if text:
        with pytest.raises(DeclarationError):
            wrong = tmp_path / "missing-section.toml"
            wrong.write_text(text)
            load(wrong)


def test_workspace_layout_follows_the_service_dir(tmp_path):
    workspace = workspace_for(tmp_path)
    assert workspace.values_file == tmp_path / "infra" / ".env"


def test_plane_root_is_the_shared_package_root():
    assert PLANE_ROOT.name == "terraform"
    assert (PLANE_ROOT / "main.tf").exists()


def test_workspace_values_file_override(tmp_path):
    central = tmp_path / "central.env"
    workspace = workspace_for(tmp_path, central)
    assert workspace.values_file == central


def test_toml_keys_are_plain_names(tmp_path):
    toml = tmp_path / "secrets.toml"
    toml.write_text(
        '[service]\nslug = "x"\n\n[secrets]\nkeys = ["W", "X", "Y", "Z"]\n\n'
        '[ssm]\nkeys = ["P", "Q", "R", "S"]\n'
    )
    data = tomllib.loads(toml.read_text())
    assert data["secrets"]["keys"] == ["W", "X", "Y", "Z"]
    load(toml)  # the committed shape loads; nothing to derive from it here
