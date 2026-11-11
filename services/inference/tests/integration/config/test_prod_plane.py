"""The prod plane through the seeded floci emulator, exactly as
make secrets-apply ages it: the round-trip proof that everything seeding
wrote comes back out of the real AWS-shaped planes — and skips (not fails)
when the emulator is down. Secret values never echo; failures name the key.
"""

import socket
from pathlib import Path

import pytest

from app.config import ConfigFactory, Settings, deployment_flick
from app.config.adapters.dotenv import DotEnvAdapter
from app.config.errors import ConfigFetchError

FLOCI_ADDR = ("127.0.0.1", 4566)
PLANE_PATH = Path(__file__).resolve().parents[3] / "infra" / ".env"

_SECRET_NAMES = ("API_KEY", "HF_TOKEN", "NEW_RELIC_LICENSE_KEY")
_INT_KNOBS = ("GRPC_PORT",)
_FLOAT_KNOBS = ("OTEL_TRACE_SAMPLE_RATIO",)
_LEVEL_KNOBS = ("LOG_LEVEL",)
_TEXT_KNOBS = (
    "MODEL_CACHE_DIR",
    "FLARE_MODEL_REPO",
    "FLARE_MODEL_REVISION",
    "FLARE_MODEL_DIR",
    "SPARK_MODEL_REPO",
    "SPARK_MODEL_REVISION",
    "SPARK_MODEL_DIR",
    "OTEL_SERVICE_NAME",
)
_OPTIONAL_KNOBS = ("OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_SERVICE_VERSION")


def _floci_reachable() -> bool:
    try:
        with socket.create_connection(FLOCI_ADDR, timeout=1.0):
            return True
    except OSError:
        return False


def _plane(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, region: str) -> None:
    monkeypatch.setenv("ENV_TYPE", "prod")
    monkeypatch.setenv("AWS_REGION", region)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    # the shared-credential chain stays out of the boot: no host ~/.aws leak
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "credentials"))
    monkeypatch.setenv("AWS_ENDPOINT_URL", "http://localhost:4566")


def _seeded_value(name: str, seeded: str) -> int | float | str:
    if name in _INT_KNOBS:
        return int(seeded)
    if name in _FLOAT_KNOBS:
        return float(seeded)
    if name in _LEVEL_KNOBS:
        return seeded.strip().upper()
    return seeded


def test_the_prod_plane_reads_the_seeded_floci_planes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    if not _floci_reachable():
        pytest.skip("floci not reachable on :4566")

    env = DotEnvAdapter(PLANE_PATH).fetch()
    _plane(monkeypatch, tmp_path, env["AWS_REGION"])

    settings = Settings.from_provider(ConfigFactory.create(deployment_flick()))

    for name in _SECRET_NAMES:
        seeded = env.get(name, "")
        resolved = getattr(settings, name.lower())
        if seeded == "":
            assert resolved is None, f"{name} must stay unset when the plane does not seed it"
        elif resolved != seeded:
            pytest.fail(f"{name} did not come off the seeded secrets blob")

    for name in (*_INT_KNOBS, *_FLOAT_KNOBS, *_LEVEL_KNOBS, *_TEXT_KNOBS):
        seeded = env.get(name, "")
        if seeded == "":
            continue
        assert getattr(settings, name.lower()) == _seeded_value(name, seeded), (
            f"{name} did not come off the seeded SSM tree"
        )

    for name in _OPTIONAL_KNOBS:
        seeded = env.get(name, "")
        assert getattr(settings, name.lower()) == (seeded or None), (
            f"{name} did not come off the seeded SSM tree"
        )


def test_a_dead_plane_fails_the_boot_loudly(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Hermetic: no seeded plane needed — an unreachable endpoint must land in
    # the typed error naming the secret and the fix, never a silent fallback.
    _plane(monkeypatch, tmp_path, "ap-southeast-2")
    monkeypatch.setenv("AWS_ENDPOINT_URL", "http://localhost:9999")

    with pytest.raises(ConfigFetchError) as excinfo:
        Settings.from_provider(ConfigFactory.create(deployment_flick()))

    assert "detectai/inference/secrets" in str(excinfo.value)
    assert "secrets-apply" in str(excinfo.value)
