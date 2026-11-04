"""Shared fixtures: the document-parser declaration, workspaces, and fake carrier sessions."""

from __future__ import annotations

import pytest

from secretsctl import config

DP_TOML = """\
[service]
slug = "document-parser"

[state]
emulator_default = "detectai-docparser-tfstate"

[secrets]
keys = ["API_KEY", "NEW_RELIC_LICENSE_KEY"]

[secrets.min_lengths]
API_KEY = 16

[requires]
"OTEL_EXPORTER_OTLP_ENDPOINT" = ["NEW_RELIC_LICENSE_KEY", 16]

[ssm]
keys = ["UPLOAD_LIMIT_BYTES", "MAX_PDF_PAGES", "OTEL_TRACE_SAMPLE_RATIO", "OTEL_EXPORTER_OTLP_ENDPOINT"]
"""

DP = config.Declaration(
    slug="document-parser",
    secret_name="detectai/document-parser/secrets",
    ssm_prefix="/detectai/document-parser/",
    blob_keys=("API_KEY", "NEW_RELIC_LICENSE_KEY"),
    ssm_keys=(
        "UPLOAD_LIMIT_BYTES",
        "MAX_PDF_PAGES",
        "OTEL_TRACE_SAMPLE_RATIO",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
    ),
    min_lengths={"API_KEY": 16},
    requires={"OTEL_EXPORTER_OTLP_ENDPOINT": ("NEW_RELIC_LICENSE_KEY", 16)},
    seeder_role_name="detectai-document-parser-seeder",
    emulator_bucket="detectai-docparser-tfstate",
    region_default="ap-southeast-2",
    recovery_window=30,
)


def write_service(tmp_path, env_text: str, toml_text: str | None = None) -> config.Workspace:
    (tmp_path / "secrets.toml").write_text(toml_text if toml_text is not None else DP_TOML)
    workspace = config.workspace_for(tmp_path)
    if env_text is not None:
        workspace.values_file.parent.mkdir(parents=True, exist_ok=True)
        workspace.values_file.write_text(env_text)
    return workspace


def render_env(values: dict[str, str]) -> str:
    return "".join(f"{key}={value}\n" for key, value in values.items())


@pytest.fixture
def ws_env(tmp_path):
    """A workspace whose values file is an empty .env; tests write text into it."""
    return write_service(tmp_path, "")


@pytest.fixture
def dp() -> config.Declaration:
    return DP


USER_ARN = "arn:aws:iam::123456789012:user/kunalpisolkar"
ROLE_ARN = "arn:aws:iam::123456789012:role/detectai-document-parser-seeder"

EMULATOR_ENV = {"API_KEY": "a" * 20}
REAL_ENV = {"API_KEY": "a" * 20, "TF_STATE_BUCKET": "detectai-tfstate-sandbox"}


def fake_carrier_session(declaration, values, is_emulator, dry_run, session_cache=None):
    """Stand-in for resolve_carrier_session: None off the real plane, otherwise a
    far-future session — real-plane main() tests stay hermetic and land on AWS."""
    return (
        None
        if is_emulator or dry_run
        else {
            "role_arn": ROLE_ARN,
            "access_key_id": "ASIAFAKEID000000",
            "secret_access_key": "fake-secret",
            "session_token": "fake-token",
            "expires_at": "2086-01-01T00:00:00Z",
        }
    )
