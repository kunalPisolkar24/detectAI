"""Black-box runs of `python -m app` against a live Floci.

Each test drives a throwaway service (unique slug) through the real CLI as a
subprocess. A service is just its secrets.toml plus infra/.env: the engine
owns the shared terraform root, so the fixture scaffolds nothing else.
stdin is /dev/null throughout: any prompt would EOF-fail the run, which proves
the emulator plane never asks.

Nothing survives the run: the service fixture's teardown re-runs the destroy
chain after every test (rerunnable and prompt-free on the emulator, even when
the test body failed), and a session hygiene gate sweeps stale itn-* leftovers
at startup and asserts that the sandbox namespaces end the run empty.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

import pytest
from app.seeder import SEEDER_POLICY_NAME

FLOCI_URL = os.environ.get("SECRETSCTL_FLOCI", "http://localhost:4566")
REGION = "ap-southeast-2"
PACKAGE_ROOT = Path(__file__).resolve().parents[2]

ITN_SLUG_PREFIX = "itn-"

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


@pytest.fixture(scope="session")
def floci() -> str:
    if not floci_reachable():
        pytest.skip(f"no Floci reachable at {FLOCI_URL} (set SECRETSCTL_FLOCI to override)")
    return FLOCI_URL


# The leave-nothing contract: sandbox namespaces for throwaway itn-* services.


def aws(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["aws", "--endpoint-url", FLOCI_URL, "--region", REGION, *arguments],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=60,
    )


def aws_json(*arguments: str) -> Any:
    result = aws(*arguments)
    if result.returncode != 0:
        raise AssertionError(f"aws {' '.join(arguments)} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def itn_state_buckets() -> list[str]:
    payload = aws_json("s3api", "list-buckets", "--output", "json")
    return [
        bucket["Name"]
        for bucket in payload["Buckets"]
        if bucket["Name"].startswith(f"detectai-{ITN_SLUG_PREFIX}")
    ]


def itn_secret_names() -> list[str]:
    payload = aws_json("secretsmanager", "list-secrets", "--output", "json")
    return [
        secret["Name"]
        for secret in payload["SecretList"]
        if secret["Name"].startswith(f"detectai/{ITN_SLUG_PREFIX}/")
    ]


def itn_parameter_names() -> list[str]:
    payload = aws_json(
        "ssm", "get-parameters-by-path", "--path", "/detectai/", "--recursive", "--output", "json"
    )
    return [
        parameter["Name"]
        for parameter in payload["Parameters"]
        if parameter["Name"].startswith(f"/detectai/{ITN_SLUG_PREFIX}/")
    ]


def itn_role_names() -> list[str]:
    payload = aws_json("iam", "list-roles", "--output", "json")
    return [
        role["RoleName"]
        for role in payload["Roles"]
        if role["RoleName"].startswith(f"detectai-{ITN_SLUG_PREFIX}")
    ]


def collect_itn_leftovers() -> dict[str, list[str]]:
    return {
        "state bucket": itn_state_buckets(),
        "secret": itn_secret_names(),
        "ssm parameter": itn_parameter_names(),
        "iam role": itn_role_names(),
    }


def delete_bucket_completely(bucket: str) -> None:
    payload = aws_json("s3api", "list-object-versions", "--bucket", bucket, "--output", "json")
    for kind in ("Versions", "DeleteMarkers"):
        for entry in payload.get(kind) or []:
            aws(
                "s3api",
                "delete-object",
                "--bucket",
                bucket,
                "--key",
                entry["Key"],
                "--version-id",
                entry["VersionId"],
            )
    aws("s3api", "delete-bucket", "--bucket", bucket)


def sweep_itn_leftovers() -> None:
    """Delete stale itn-* data from crashed or suppressed teardowns before the run."""
    for bucket in itn_state_buckets():
        delete_bucket_completely(bucket)
    for name in itn_secret_names():
        aws(
            "secretsmanager",
            "delete-secret",
            "--secret-id",
            name,
            "--force-delete-without-recovery",
        )
    for name in itn_parameter_names():
        aws("ssm", "delete-parameters", "--name", name)
    for name in itn_role_names():
        aws("iam", "delete-role-policy", "--role-name", name, "--policy-name", SEEDER_POLICY_NAME)
        aws("iam", "delete-role", "--role-name", name)
    assert_sandbox_empty()


def assert_sandbox_empty() -> None:
    """Survivors after a sweep are a bug: the run cannot proceed on them."""
    survivors = {kind: names for kind, names in collect_itn_leftovers().items() if names}
    if survivors:
        raise AssertionError(
            f"the floci sandbox could not be cleared:\n{survivors_as_text(survivors)}"
        )


def survivors_as_text(survivors: dict[str, list[str]]) -> str:
    return "\n".join(f"  {kind}: {', '.join(sorted(names))}" for kind, names in survivors.items())


@pytest.fixture(scope="session")
def floci_hygiene(floci) -> None:
    """Guarantee the run starts in a clean sandbox and ends leaving it clean."""
    sweep_itn_leftovers()
    yield
    survivors = {kind: names for kind, names in collect_itn_leftovers().items() if names}
    if survivors:
        pytest.fail(
            f"the integration run left floci data behind:\n{survivors_as_text(survivors)}",
            pytrace=False,
        )


@pytest.fixture
def service(floci_hygiene, tmp_path):
    slug = f"{ITN_SLUG_PREFIX}{uuid.uuid4().hex[:10]}"
    (tmp_path / "secrets.toml").write_text(
        f'[service]\nslug = "{slug}"\n\n[secrets]\nkeys = ["API_KEY"]\n\n'
        '[ssm]\nkeys = ["MAX_PDF_PAGES"]\n'
    )
    infra = tmp_path / "infra"
    infra.mkdir()
    (infra / ".env").write_text(f"API_KEY={'k' * 24}\nMAX_PDF_PAGES=1200\n")
    yield tmp_path, slug
    teardown_service(tmp_path)


def run_cli(service_dir: Path, *arguments: str, timeout: int = 600) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PACKAGE_ROOT)
    env.setdefault("TF_PLUGIN_CACHE_DIR", str(PACKAGE_ROOT / ".tfcache"))
    return subprocess.run(
        [sys.executable, "-m", "app", *arguments],
        cwd=service_dir,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        env=env,
        timeout=timeout,
    )


def teardown_service(service_dir: Path) -> None:
    result = run_cli(service_dir, "destroy", "--purge-state", "--drop-seeder")
    if result.returncode != 0:
        print(f"\nwarning: the teardown failed for {service_dir}")
        print(result.stdout)
        print(result.stderr)


def seed(service_dir: Path) -> None:
    apply = run_cli(service_dir, "apply")
    assert apply.returncode == 0, apply.stdout + apply.stderr


def test_happy_path_apply_then_verify(service):
    service_dir, slug = service
    apply = run_cli(service_dir, "apply")
    assert apply.returncode == 0, apply.stdout + apply.stderr
    # The convergence ladder rides the first apply: a fresh emulator means
    # neither the seeder role nor the derived state bucket pre-exists.
    assert f"note: seeder role detectai-{slug}-seeder is missing; creating it" in apply.stdout
    assert f"created: detectai-{slug}-seeder (12h session cap)" in apply.stdout
    assert f"carrier: assuming detectai-{slug}-seeder" in apply.stdout
    assert f"created: detectai-{slug}-tfstate-000000000000" in apply.stdout
    assert "versioning: Enabled" in apply.stdout

    plan = run_cli(service_dir, "plan")
    assert plan.returncode == 0, plan.stdout + plan.stderr
    assert f"carrier: role session (detectai-{slug}-seeder, valid " in plan.stdout
    assert "carrier: assuming" not in plan.stdout  # the cached triplet rides every later verb

    verify = run_cli(service_dir, "verify")
    assert verify.returncode == 0, verify.stdout + verify.stderr
    assert "ok:      the seeded plane matches the .env values" in verify.stdout
    assert f"carrier: role session (detectai-{slug}-seeder, valid " in verify.stdout


def test_the_carrier_recreates_a_dropped_role(service):
    service_dir, slug = service
    seed(service_dir)

    drop = run_cli(service_dir, "seeder-drop")
    assert drop.returncode == 0, drop.stdout + drop.stderr
    # A stale cached session is the stale-session contract on both planes: clearing it is manual.
    clear = run_cli(service_dir, "session-clear")
    assert clear.returncode == 0, clear.stdout + clear.stderr

    plan = run_cli(service_dir, "plan")
    assert plan.returncode == 0, plan.stdout + plan.stderr
    assert f"note: seeder role detectai-{slug}-seeder is missing; creating it" in plan.stdout
    assert "carrier: assuming" in plan.stdout

    verify = run_cli(service_dir, "verify")
    assert verify.returncode == 0, verify.stdout + verify.stderr


def test_plan_is_idempotent_after_apply(service):
    service_dir, _ = service
    seed(service_dir)
    plan = run_cli(service_dir, "plan")
    assert plan.returncode == 0, plan.stdout + plan.stderr
    assert "No changes." in plan.stdout


def test_verify_detects_an_ssm_tamper(service):
    service_dir, slug = service
    seed(service_dir)
    tamper = aws(
        "ssm",
        "put-parameter",
        "--name",
        f"/detectai/{slug}/MAX_PDF_PAGES",
        "--type",
        "String",
        "--value",
        "999",
        "--overwrite",
    )
    assert tamper.returncode == 0, tamper.stderr

    verify = run_cli(service_dir, "verify")
    assert verify.returncode == 1
    assert "does not match .env" in verify.stdout
    assert "fail:    the seeded plane does not match the .env values" in verify.stdout


def test_destroy_purge_then_reapply_self_heals(service):
    service_dir, slug = service
    seed(service_dir)

    destroy = run_cli(service_dir, "destroy", "--purge-state")
    assert destroy.returncode == 0, destroy.stdout + destroy.stderr
    assert f"deleted: detectai-{slug}-tfstate-000000000000" in destroy.stdout

    gone = aws("s3api", "head-bucket", "--bucket", f"detectai-{slug}-tfstate-000000000000")
    assert gone.returncode != 0

    reapply = run_cli(service_dir, "apply")
    assert reapply.returncode == 0, reapply.stdout + reapply.stderr
    assert "is missing; creating it" in reapply.stdout

    verify = run_cli(service_dir, "verify")
    assert verify.returncode == 0, verify.stdout + verify.stderr


def test_apply_twice_leaves_the_bucket_alone(service):
    service_dir, slug = service
    seed(service_dir)  # the first apply creates the seeder role and the derived bucket

    second = run_cli(service_dir, "apply")
    assert second.returncode == 0, second.stdout + second.stderr
    assert "is missing; creating it" not in second.stdout  # the bucket already rides
    head = aws("s3api", "head-bucket", "--bucket", f"detectai-{slug}-tfstate-000000000000")
    assert head.returncode == 0


def test_destroy_leaves_the_role_and_state_intact_without_flags(service):
    service_dir, slug = service
    seed(service_dir)

    destroy = run_cli(service_dir, "destroy")
    assert destroy.returncode == 0, destroy.stdout + destroy.stderr

    head = aws("s3api", "head-bucket", "--bucket", f"detectai-{slug}-tfstate-000000000000")
    assert head.returncode == 0  # no --purge-state: the bucket survives until teardown
    role = aws("iam", "get-role", "--role-name", f"detectai-{slug}-seeder")
    assert role.returncode == 0  # no --drop-seeder: the carrier survives until teardown
