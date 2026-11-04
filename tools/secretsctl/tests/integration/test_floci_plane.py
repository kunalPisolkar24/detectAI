"""Black-box runs of `python -m secretsctl` against a live Floci.

Each test drives a throwaway service (unique slug, its own minimal terraform
stack) through the real CLI as a subprocess. stdin is /dev/null throughout:
any prompt would EOF-fail the run, which proves the emulator plane never asks.
"""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

FLOCI_URL = os.environ.get("SECRETSCTL_FLOCI", "http://localhost:4566")
REGION = "ap-southeast-2"
PACKAGE_ROOT = Path(__file__).resolve().parents[2]

pytestmark = pytest.mark.integration

VERSIONS_TF = """\
terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}
"""

MAIN_TF = """\
variable "aws_region" {
  type = string
}

variable "service_slug" {
  type = string
}

variable "secret_recovery_window" {
  type = number
}

variable "emulator_endpoint" {
  type = string
}

variable "blob" {
  type    = map(string)
  default = {}
}

variable "ssm_parameters" {
  type    = map(string)
  default = {}
}

provider "aws" {
  region                      = var.aws_region
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
  s3_use_path_style           = true

  endpoints {
    s3             = var.emulator_endpoint
    secretsmanager = var.emulator_endpoint
    ssm            = var.emulator_endpoint
  }
}

resource "aws_secretsmanager_secret" "blob" {
  name                    = "detectai/${var.service_slug}/secrets"
  recovery_window_in_days = var.secret_recovery_window
}

resource "aws_secretsmanager_secret_version" "blob" {
  secret_id     = aws_secretsmanager_secret.blob.id
  secret_string = jsonencode(var.blob)
}

resource "aws_ssm_parameter" "config" {
  for_each = var.ssm_parameters
  name     = "/detectai/${var.service_slug}/${each.key}"
  type     = "String"
  value    = each.value
}
"""


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


@pytest.fixture(scope="module")
def floci() -> str:
    if not floci_reachable():
        pytest.skip(f"no Floci reachable at {FLOCI_URL} (set SECRETSCTL_FLOCI to override)")
    return FLOCI_URL


@pytest.fixture
def service(tmp_path, floci):
    slug = f"itn-{uuid.uuid4().hex[:10]}"
    (tmp_path / "secrets.toml").write_text(
        f'[service]\nslug = "{slug}"\n\n[secrets]\nkeys = ["API_KEY"]\n\n'
        '[ssm]\nkeys = ["MAX_PDF_PAGES"]\n'
    )
    infra = tmp_path / "infra"
    infra.mkdir()
    (infra / ".env").write_text(
        f"API_KEY={'k' * 24}\nMAX_PDF_PAGES=1200\nEMULATOR_ENDPOINT={floci}\n"
    )
    tf_dir = infra / "terraform"
    tf_dir.mkdir()
    (tf_dir / "versions.tf").write_text(VERSIONS_TF)
    (tf_dir / "main.tf").write_text(MAIN_TF)
    return tmp_path, slug


def run_cli(service_dir: Path, *arguments: str, timeout: int = 600) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(PACKAGE_ROOT / "src")
    env.setdefault("TF_PLUGIN_CACHE_DIR", str(PACKAGE_ROOT / ".tfcache"))
    return subprocess.run(
        [sys.executable, "-m", "secretsctl", *arguments],
        cwd=service_dir,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        env=env,
        timeout=timeout,
    )


def aws(service_dir: Path, *arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["aws", "--endpoint-url", FLOCI_URL, "--region", REGION, *arguments],
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
        timeout=60,
    )


def seed(service_dir: Path) -> None:
    assert run_cli(service_dir, "bootstrap").returncode == 0
    assert run_cli(service_dir, "apply").returncode == 0


def test_happy_path_bootstrap_apply_then_verify(service):
    service_dir, slug = service
    bootstrap = run_cli(service_dir, "bootstrap")
    assert bootstrap.returncode == 0, bootstrap.stdout + bootstrap.stderr
    assert f"created: detectai-{slug}-tfstate" in bootstrap.stdout

    apply = run_cli(service_dir, "apply")
    assert apply.returncode == 0, apply.stdout + apply.stderr

    verify = run_cli(service_dir, "verify")
    assert verify.returncode == 0, verify.stdout + verify.stderr
    assert "ok:      the seeded plane matches the .env values" in verify.stdout


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
        service_dir,
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
    assert f"deleted: detectai-{slug}-tfstate" in destroy.stdout

    gone = aws(service_dir, "s3api", "head-bucket", "--bucket", f"detectai-{slug}-tfstate")
    assert gone.returncode != 0

    reapply = run_cli(service_dir, "apply")
    assert reapply.returncode == 0, reapply.stdout + reapply.stderr
    assert "is missing; creating it" in reapply.stdout

    verify = run_cli(service_dir, "verify")
    assert verify.returncode == 0, verify.stdout + verify.stderr


def test_bootstrap_twice_is_idempotent(service):
    service_dir, slug = service
    first = run_cli(service_dir, "bootstrap")
    assert first.returncode == 0, first.stdout + first.stderr
    assert f"created: detectai-{slug}-tfstate" in first.stdout

    second = run_cli(service_dir, "bootstrap")
    assert second.returncode == 0, second.stdout + second.stderr
    assert f"ok:  bucket detectai-{slug}-tfstate already exists" in second.stdout


def test_destroy_leaves_the_role_and_state_intact_without_flags(service):
    service_dir, slug = service
    seed(service_dir)
    destroy = run_cli(service_dir, "destroy")
    assert destroy.returncode == 0, destroy.stdout + destroy.stderr

    head = aws(service_dir, "s3api", "head-bucket", "--bucket", f"detectai-{slug}-tfstate")
    assert head.returncode == 0  # no --purge-state: the bucket survives
    role = aws(service_dir, "iam", "get-role", "--role-name", f"detectai-{slug}-seeder")
    assert role.returncode == 0  # no --drop-seeder: the carrier survives
