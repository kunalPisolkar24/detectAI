"""Black-box runs of `python -m app` against live Floci for the observability kind.

The shared persistent namespace (the
`detectai-observability-tfstate-000000000000` bucket, the
`detectai-observability-seeder` role, the `observability/floci` state key)
is exercised in place — nothing here sweeps or destroys it, and nothing
publishes to New Relic: a plan is read-only, so the test plan level stops
there. Skipped without a live Floci or a configured `envs/.env`.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest
from app.kinds.locate import REPO_ROOT

FLOCI_URL = os.environ.get("TFCTL_FLOCI", "http://localhost:4566")
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
OBS_DIR = REPO_ROOT / "observability"

pytestmark = pytest.mark.integration


def floci_reachable() -> bool:
    try:
        probe = subprocess.run(
            [
                "aws",
                "--endpoint-url",
                FLOCI_URL,
                "--region",
                "ap-southeast-2",
                "sts",
                "get-caller-identity",
            ],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return probe.returncode == 0


@pytest.fixture(scope="module")
def values_ready() -> None:
    if not floci_reachable():
        pytest.skip(f"no Floci reachable at {FLOCI_URL} (set TFCTL_FLOCI to override)")
    env_file = OBS_DIR / "envs" / ".env"
    if not env_file.exists() or "NRAK-" not in env_file.read_text():
        pytest.skip(f"no configured env file at {env_file} (run `make env` in observability)")


def run_cli(*arguments: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PACKAGE_ROOT)
    env.setdefault("TF_PLUGIN_CACHE_DIR", str(PACKAGE_ROOT / ".tfcache"))
    return subprocess.run(
        [sys.executable, "-m", "app", "--stack-dir", str(OBS_DIR), *arguments],
        cwd=PACKAGE_ROOT,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        env=env,
        timeout=900,
    )


def test_check_resolves_the_account_live(values_ready):
    result = run_cli("check")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "plane:  floci" in result.stdout
    assert "live: region EU" in result.stdout


def test_plan_rides_the_persistent_state_plane(values_ready):
    result = run_cli("plan")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "plane:   floci" in result.stdout
    assert "detectai-observability-seeder" in result.stdout
    assert "state:  detectai-observability-tfstate-000000000000 / observability/floci/terraform.tfstate" in (
        result.stdout
    )

    rerun = run_cli("plan")
    assert rerun.returncode == 0, rerun.stdout + rerun.stderr
    assert "carrier:" in rerun.stdout
