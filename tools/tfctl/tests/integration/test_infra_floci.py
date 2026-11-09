"""Black-box runs of `python -m app` against live Floci for the infra kind.

The committed stack under `infra/` plans read-only against the shared
persistent namespace (the `detectai-infra-tfstate-000000000000` bucket, the
`detectai-infra-seeder` role, the `infra/floci` state key) — nothing here
applies, destroys, or publishes anything. Skipped without live Floci.
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
INFRA_DIR = REPO_ROOT / "infra"

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
    env_file = INFRA_DIR / "envs" / ".env"
    if not env_file.exists():
        pytest.skip(f"no values file at {env_file} (run `make env` in infra)")


def run_cli(*arguments: str) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PACKAGE_ROOT)
    env.setdefault("TF_PLUGIN_CACHE_DIR", str(PACKAGE_ROOT / ".tfcache"))
    return subprocess.run(
        [sys.executable, "-m", "app", *arguments],
        cwd=PACKAGE_ROOT,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        env=env,
        timeout=900,
    )


def test_plan_rides_the_persistent_state_plane(values_ready):
    result = run_cli("plan", "--stack-dir", str(INFRA_DIR))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "plane:   floci" in result.stdout
    assert "detectai-infra-seeder" in result.stdout
    assert "state:  detectai-infra-tfstate-000000000000 / infra/floci/terraform.tfstate" in (
        result.stdout
    )
    assert "queues:  2 declared" in result.stdout

    rerun = run_cli("plan", "--stack-dir", str(INFRA_DIR))
    assert rerun.returncode == 0, rerun.stdout + rerun.stderr
    assert "carrier:" in rerun.stdout
