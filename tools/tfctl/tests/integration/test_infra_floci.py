"""Black-box runs of `python -m app` against live Floci for the infra kind.

Two tiers here:
- the real committed stack under `infra/` plans read-only against the shared
  persistent namespace (the `detectai-infra-tfstate` bucket, the
  `detectai-infra-seeder` role, the `infra/floci` state key) — nothing
  destructive;
- the sandbox: an `itn_`-prefixed copy of the stack root with its own bucket
  and queue ledger, which auto-applies, verifies the live queue shape, and
  destroys (state purge included) before finishing. Skipped without live Floci.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest
from app.kinds.locate import REPO_ROOT

FLOCI_URL = os.environ.get("TFCTL_FLOCI", "http://localhost:4566")
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
INFRA_DIR = REPO_ROOT / "infra"
REGION = "eu-central-1"

SANDBOX_TOML = (
    '[service]\nslug = "infra"\nregion = "eu-central-1"\n\n'
    '[[queues]]\nname = "itn_payment_events.fifo"\ndlq = "itn_payment_events_dlq.fifo"\n'
    "max_receive_count = 5\n\n"
    '[[queues]]\nname = "itn_payment_events_dlq.fifo"\n'
)

SANDBOX_ENV = {"AWS_REGION": REGION, "TF_STATE_BUCKET": "detectai-itn-infra-tfstate"}

MAIN_QUEUE = "itn_payment_events.fifo"
DLQ_QUEUE = "itn_payment_events_dlq.fifo"

pytestmark = pytest.mark.integration


def floci_reachable() -> bool:
    try:
        probe = subprocess.run(
            ["aws", "--endpoint-url", FLOCI_URL, "--region", REGION, "sts", "get-caller-identity"],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return probe.returncode == 0


def floci_env() -> dict[str, str]:
    env = os.environ.copy()
    env.pop("AWS_PROFILE", None)
    env.pop("AWS_SESSION_TOKEN", None)
    env |= {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
    return env


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


def run_aws(*arguments: str) -> tuple[int, str]:
    probe = subprocess.run(
        ["aws", "--endpoint-url", FLOCI_URL, "--region", REGION, "sqs", *arguments],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        env=floci_env(),
        timeout=60,
    )
    return probe.returncode, probe.stdout


def queue_url(name: str) -> str:
    return f"{FLOCI_URL}/000000000000/{name}"


def get_queue_attributes(name: str) -> dict[str, str]:
    code, stdout = run_aws(
        "get-queue-attributes",
        "--queue-url",
        queue_url(name),
        "--attribute-names",
        "All",
        "--output",
        "json",
    )
    assert code == 0, f"{name} missing from the floci plane"
    return json.loads(stdout)["Attributes"]


def test_plan_rides_the_persistent_state_plane(values_ready):
    result = run_cli("plan", "--stack-dir", str(INFRA_DIR))
    assert result.returncode == 0, result.stdout + result.stderr
    assert "plane:   floci" in result.stdout
    assert "detectai-infra-seeder" in result.stdout
    assert "state:  detectai-infra-tfstate / infra/floci/terraform.tfstate" in result.stdout
    assert "queues:  2 declared" in result.stdout

    rerun = run_cli("plan", "--stack-dir", str(INFRA_DIR))
    assert rerun.returncode == 0, rerun.stdout + rerun.stderr
    assert "carrier:" in rerun.stdout


def test_sandbox_apply_verifies_and_destroys_cleanly(values_ready):
    """Full itn_-ledger lifecycle: apply, verify the live shape, destroy + purge."""
    with tempfile.TemporaryDirectory() as tmp:
        sandbox = Path(tmp)
        shutil.copytree(
            INFRA_DIR / "terraform",
            sandbox / "terraform",
            ignore=lambda directory, names: [name for name in names if name == ".terraform"],
        )
        (sandbox / "infra.toml").write_text(SANDBOX_TOML)
        envs = sandbox / "envs"
        envs.mkdir()
        envs.joinpath(".env").write_text(
            "".join(f"{key}={value}\n" for key, value in SANDBOX_ENV.items())
        )

        applied = run_cli("auto-apply", "--stack-dir", str(sandbox))
        assert applied.returncode == 0, applied.stdout + applied.stderr
        assert "plane:   floci" in applied.stdout
        assert "state:  detectai-itn-infra-tfstate / infra/floci/terraform.tfstate" in (
            applied.stdout
        )
        assert "Apply complete" in applied.stdout

        attrs = get_queue_attributes(MAIN_QUEUE)
        assert attrs["FifoQueue"] == "true"
        assert attrs["ContentBasedDeduplication"] == "false"
        assert attrs["VisibilityTimeout"] == "300"
        assert attrs["MessageRetentionPeriod"] == "1209600"
        redrive = json.loads(attrs["RedrivePolicy"])
        assert redrive["maxReceiveCount"] == 5
        assert redrive["deadLetterTargetArn"].endswith(DLQ_QUEUE)

        dlq_attrs = get_queue_attributes(DLQ_QUEUE)
        assert dlq_attrs["FifoQueue"] == "true"
        assert "RedrivePolicy" not in dlq_attrs

        code, stdout = run_aws("list-queue-tags", "--queue-url", queue_url(MAIN_QUEUE))
        assert code == 0 and json.loads(stdout)["Tags"] == {
            "Project": "detectai",
            "ManagedBy": "terraform",
        }

        code, stdout = run_aws(
            "send-message",
            "--queue-url",
            queue_url(MAIN_QUEUE),
            "--message-body",
            '{"event_id":"itn-probe"}',
            "--message-deduplication-id",
            "itn_probe_dedup",
            "--message-group-id",
            "itn_group",
        )
        assert code == 0
        code, stdout = run_aws(
            "receive-message",
            "--queue-url",
            queue_url(MAIN_QUEUE),
            "--max-number-of-messages",
            "1",
            "--attribute-names",
            "All",
            "--wait-time-seconds",
            "5",
            "--output",
            "json",
        )
        message = json.loads(stdout)["Messages"][0]
        assert message["Attributes"]["MessageDeduplicationId"] == "itn_probe_dedup"
        assert message["Attributes"]["MessageGroupId"] == "itn_group"

        destroyed = run_cli("destroy", "--purge-state", "--stack-dir", str(sandbox))
        assert destroyed.returncode == 0, destroyed.stdout + destroyed.stderr
        assert f"deleted: {SANDBOX_ENV['TF_STATE_BUCKET']}" in destroyed.stdout

        code, stdout = run_aws(
            "list-queues", "--queue-name-prefix", "itn_payment", "--output", "json"
        )
        assert code == 0 and (json.loads(stdout).get("QueueUrls") or []) == []

        head = subprocess.run(
            [
                "aws",
                "--endpoint-url",
                FLOCI_URL,
                "--region",
                REGION,
                "s3api",
                "head-bucket",
                "--bucket",
                SANDBOX_ENV["TF_STATE_BUCKET"],
            ],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            env=floci_env(),
            timeout=60,
        )
        assert head.returncode != 0  # the sandbox state bucket is gone with its purge
