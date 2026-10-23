#!/usr/bin/env python3
"""Seed the document-parser Secrets Manager blob from the service .env.

Input compiler only: parse and validate infra/.env, map the values onto
TF_VAR_* environment variables, then drive `terraform plan/apply` for the
service-scoped stack (infra/terraform). The script never talks to AWS itself —
terraform is the only component touching it.

Plane selection (single flick, from EMULATOR_ENDPOINT in .env):
  - http(s) URL     -> Floci/LocalStack; state in the emulator's S3; auto-approved
  - unset or empty  -> real AWS; state in the backend.prod.hcl bucket; confirm prompt
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

SERVICE_DIR = Path(__file__).resolve().parents[1]
TF_DIR = SERVICE_DIR / "infra" / "terraform"
ENV_FILE = SERVICE_DIR / "infra" / ".env"
PROD_BACKEND_FILE = TF_DIR / "backend.prod.hcl"

SECRETS_NAME_DEFAULT = "detectai/document-parser/secrets"

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")
URL_RE = re.compile(r"^https?://\S+$")
API_KEY_MIN_LENGTH = 16
ENV_TYPES = ("dev", "prod")
EMULATOR_RECOVERY_WINDOW = 0
PROD_RECOVERY_WINDOW = 30


def die(message: str, fix: str) -> NoReturn:
    print(f"error: {message}")
    print(f"fix:   {fix}")
    sys.exit(1)


def parse_env_file(path: Path) -> dict[str, str]:
    """KEY=value parser: strips inline comments, keeps the first duplicate."""
    values: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = re.sub(r"\s+#.*$", "", value).strip()
        if not key:
            print(f"warning: {path.name}:{lineno}: empty key before '='; skipped")
            continue
        if key in values:
            print(f"warning: {path.name}:{lineno}: duplicate {key}; keeping the first")
            continue
        values[key] = value
    return values


def validate(values: dict[str, str]) -> list[str]:
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if len(values.get("API_KEY", "")) < API_KEY_MIN_LENGTH:
        fail(
            f"API_KEY missing or shorter than {API_KEY_MIN_LENGTH} chars in {ENV_FILE}",
            "set a real key, e.g. API_KEY=<at least 16 chars>",
        )
    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-south-1",
        )
    if (env_type := values.get("ENV_TYPE")) is not None and env_type not in ENV_TYPES:
        fail(
            f"ENV_TYPE must be one of {' or '.join(ENV_TYPES)}, got {env_type!r}",
            "set ENV_TYPE=dev or ENV_TYPE=prod",
        )
    if (emu := values.get("EMULATOR_ENDPOINT")) is not None and not URL_RE.fullmatch(emu):
        fail(
            f"EMULATOR_ENDPOINT is not a valid http(s) URL: {emu!r}",
            "set it to the Floci URL (http://localhost:4566) or remove the line for real AWS",
        )
    return errors


def build_tf_vars(values: dict[str, str]) -> dict[str, str]:
    is_emulator = bool(values.get("EMULATOR_ENDPOINT"))
    tf_vars = {
        "TF_VAR_api_key": values["API_KEY"],
        "TF_VAR_aws_region": values.get("AWS_REGION", "ap-south-1"),
        "TF_VAR_secret_recovery_window": str(
            EMULATOR_RECOVERY_WINDOW if is_emulator else PROD_RECOVERY_WINDOW
        ),
    }
    if (name := values.get("DP_API_KEY_SECRET_NAME")) and name != SECRETS_NAME_DEFAULT:
        tf_vars["TF_VAR_secrets_name"] = name
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = values["EMULATOR_ENDPOINT"]
    return tf_vars


def plane_notes(values: dict[str, str], plane: str) -> list[str]:
    notes = []
    if values.get("ENV_TYPE") == "prod" and plane == "emulator (Floci)":
        notes.append("note: ENV_TYPE=prod with the emulator — the local-testing shape for the prod pull path")
    if values.get("ENV_TYPE") == "dev" and plane == "real AWS":
        notes.append("warning: applying to real AWS while ENV_TYPE=dev (dev runtime reads .env, not SM)")
    return notes


def run_terraform(args: list[str], tf_vars: dict[str, str], env_overlay: dict[str, str] | None = None) -> int:
    terraform = shutil.which("terraform")
    if terraform is None:
        die("terraform not found on PATH", "install terraform >= 1.9 (pinned ~> 1.9 in versions.tf)")
    # Backend credentials come from the environment, not the provider block: the
    # emulator's test creds must travel with it or backend init fails.
    env = os.environ | tf_vars | ({"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"} if env_overlay else {})
    print()  # separate script output from terraform's own
    try:
        return subprocess.run([terraform, f"-chdir={TF_DIR}", *args], check=False, env=env).returncode
    except OSError as exc:
        die(f"failed to run terraform: {exc}", "check the terraform installation")


def main() -> int:
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)
    parser = argparse.ArgumentParser(
        prog="secrets.py",
        description="Validate the service .env and drive the secrets terraform stack.",
    )
    parser.add_argument("command", choices=("plan", "apply"), help="the terraform verb")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="print everything that would be fed to terraform; run nothing",
    )
    args = parser.parse_args()

    if not ENV_FILE.exists():
        die(f"{ENV_FILE} not found", "run `make env` in services/document-parser first")

    values = parse_env_file(ENV_FILE)
    errors = validate(values)
    for error in errors:
        print(error)
    if errors:
        return 1

    tf_vars = build_tf_vars(values)
    plane = "emulator (Floci)" if tf_vars.get("TF_VAR_emulator_endpoint") else "real AWS"
    key_len = len(tf_vars["TF_VAR_api_key"])

    print(f"plane:  {plane}")
    print(f"stack:  {TF_DIR}")
    print(f"secret: {SECRETS_NAME_DEFAULT}")
    print(f"key:    *** ({key_len} chars, hidden)")
    for note in plane_notes(values, plane):
        print(note)

    if args.dry_run:
        print("(dry run: no terraform, no AWS)")
        return 0

    if plane == "emulator (Floci)":
        init_args = ["init", "-reconfigure", "-backend-config", "backend.floci.hcl"]
    else:
        if not PROD_BACKEND_FILE.exists():
            die(
                f"{PROD_BACKEND_FILE} not found for the real-AWS plane",
                "cp infra/terraform/backend.prod.hcl.example infra/terraform/backend.prod.hcl and fill the bucket",
            )
        init_args = ["init", "-reconfigure", "-backend-config", "backend.prod.hcl"]

    verb_args = [args.command]
    if plane == "emulator (Floci)":
        verb_args = [args.command, "-input=false", "-auto-approve"]

    is_emulator = plane == "emulator (Floci)"
    backend_creds = {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"} if is_emulator else None

    if run_terraform(init_args, tf_vars, backend_creds) != 0:
        if is_emulator:
            print()
            print("fix: create the emulator state bucket and retry")
            print("fix: aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1")
        return 1
    return run_terraform(verb_args, tf_vars, backend_creds)


if __name__ == "__main__":
    raise SystemExit(main())
