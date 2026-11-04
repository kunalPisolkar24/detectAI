"""Subprocess runners for the aws CLI and terraform, keyed by plane."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from typing import NoReturn

from secretsctl.config import Declaration
from secretsctl.env import resolve_floci_url, resolve_region


def die(message: str, fix: str) -> NoReturn:
    print(f"error: {message}")
    print(f"fix:   {fix}")
    sys.exit(1)


def aws_base(declaration: Declaration, values: dict[str, str], is_emulator: bool) -> list[str]:
    base = ["aws", "--region", resolve_region(declaration, values)]
    if is_emulator:
        base += ["--endpoint-url", resolve_floci_url()]
    return base


def aws_env(is_emulator: bool, session: dict[str, str] | None = None) -> dict[str, str]:
    """Subprocess credentials: an assumed carrier session triplet where present
    (env creds outrank any named profile, which the CLI resolves first), the
    emulator fakes when the carrier runs session-less, or the ambient
    environment untouched."""
    env = dict(os.environ)
    if session:
        env.pop("AWS_PROFILE", None)
        env |= {
            "AWS_ACCESS_KEY_ID": session["access_key_id"],
            "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
            "AWS_SESSION_TOKEN": session["session_token"],
        }
    elif is_emulator:
        env.pop("AWS_PROFILE", None)
        env.pop("AWS_SESSION_TOKEN", None)
        env |= {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
    return env


def run_aws(command: list[str], is_emulator: bool, session: dict[str, str] | None = None) -> int:
    print(f"running: {' '.join(command)}")
    try:
        return subprocess.run(command, check=False, env=aws_env(is_emulator, session)).returncode
    except OSError as exc:
        die(f"failed to run aws: {exc}", "install the AWS CLI (see README prerequisites)")


def run_aws_captured(
    command: list[str], is_emulator: bool, session: dict[str, str] | None = None
) -> tuple[int, str, str]:
    """Like run_aws but keeps the streams captured: (returncode, stdout, stderr)."""
    try:
        process = subprocess.run(
            command, check=False, env=aws_env(is_emulator, session), capture_output=True, text=True
        )
        return process.returncode, process.stdout, process.stderr
    except OSError as exc:
        die(f"failed to run aws: {exc}", "install the AWS CLI (see README prerequisites)")


def run_terraform(
    tf_dir: str | os.PathLike[str],
    args: list[str],
    tf_vars: dict[str, str],
    env_overlay: dict[str, str] | None = None,
) -> int:
    terraform = shutil.which("terraform")
    if terraform is None:
        die(
            "terraform not found on PATH",
            "install terraform (the stack's versions.tf pins the version)",
        )
    # Credentials travel in the env overlay (emulator fakes or the seeder session
    # triplet); the provider block stays out of it. The overlay also strips the
    # carrier profile: AWS_PROFILE would outrank env creds in the subprocess env.
    base = (
        os.environ
        if not env_overlay
        else {key: value for key, value in os.environ.items() if key != "AWS_PROFILE"}
    )
    env = base | tf_vars | (env_overlay or {})
    print()  # separate script output from terraform's own
    try:
        return subprocess.run(
            [terraform, f"-chdir={tf_dir}", *args], check=False, env=env
        ).returncode
    except OSError as exc:
        die(f"failed to run terraform: {exc}", "check the terraform installation")
