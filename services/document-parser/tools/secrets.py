#!/usr/bin/env python3
"""Seed the document-parser Secrets Manager blob from the service .env.

Input compiler only: parse and validate infra/.env, map the values onto
TF_VAR_* environment variables and a generated backend config, then drive
`terraform plan/apply` for the service-scoped stack (infra/terraform).
Terraform alone touches AWS on the resource path; the script's one direct
AWS-API step is the opt-in `bootstrap` verb (below, via the `aws` CLI).

Plane selection (single flick, from EMULATOR_ENDPOINT in .env):
  - http(s) URL     -> Floci/LocalStack; state in the emulator's S3; auto-approved
  - unset or empty  -> real AWS; state in the TF_STATE_BUCKET bucket; confirm prompt

State bucket comes from TF_STATE_BUCKET in .env on both planes; on the emulator
an unset value falls back to the fixed local default, while real AWS requires
it. `bootstrap` is the one direct AWS-API step the script performs (via the
`aws` CLI, opt-in): it creates the resolved bucket on the armed plane —
everything resource-side still goes through terraform alone. There are no
backend.*.hcl files: backend.example.hcl documents the shapes for scriptless
runs.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import NoReturn

SERVICE_DIR = Path(__file__).resolve().parents[1]
TF_DIR = SERVICE_DIR / "infra" / "terraform"
ENV_FILE = SERVICE_DIR / "infra" / ".env"

SECRETS_NAME_DEFAULT = "detectai/document-parser/secrets"
REGION_DEFAULT = "ap-south-1"
FLOCI_STATE_BUCKET = "detectai-tfstate-local"
FLOCI_STATE_KEY = "document-parser/floci/terraform.tfstate"
PROD_STATE_KEY = "document-parser/terraform.tfstate"

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")
URL_RE = re.compile(r"^https?://\S+$")
# S3 naming minus dots: exactly 3-63 lowercase/digits/hyphens, alnum boundaries.
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
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


def resolve_plane(values: dict[str, str]) -> tuple[str, bool]:
    is_emulator = bool(values.get("EMULATOR_ENDPOINT"))
    plane = "emulator (Floci)" if is_emulator else "real AWS"
    return plane, is_emulator


def resolve_region(values: dict[str, str]) -> str:
    return values.get("AWS_REGION") or REGION_DEFAULT


def resolve_state_bucket(is_emulator: bool, values: dict[str, str]) -> str | None:
    """State bucket for the plane: .env value if set; Floci falls back to the
    fixed local default; real AWS stays required (no guessing)."""
    bucket = values.get("TF_STATE_BUCKET", "")
    if bucket:
        return bucket
    return FLOCI_STATE_BUCKET if is_emulator else None


BUCKET_MISSING_ERROR = "the real-AWS plane needs a state bucket: TF_STATE_BUCKET is not set in .env"
BUCKET_MISSING_FIX = (
    "add TF_STATE_BUCKET=<unique 3-63 char lowercase bucket> to .env and create it "
    "(make secrets-bootstrap-state does it, or aws s3 mb + versioning)"
)
BUCKET_SHAPE_ERROR = "TF_STATE_BUCKET is not a valid S3 bucket name: {bucket!r}"
BUCKET_SHAPE_FIX = (
    "use 3-63 lowercase letters, digits or hyphens, starting and ending alphanumeric"
)


def bucket_errors(errors: list[str], bucket: str, required: bool) -> None:
    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if not bucket:
        if required:
            fail(BUCKET_MISSING_ERROR, BUCKET_MISSING_FIX)
        return
    if not BUCKET_RE.fullmatch(bucket):
        fail(BUCKET_SHAPE_ERROR.format(bucket=bucket), BUCKET_SHAPE_FIX)


def validate(is_emulator: bool, values: dict[str, str]) -> list[str]:
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
    if is_emulator:
        endpoint = values["EMULATOR_ENDPOINT"]
        if not URL_RE.fullmatch(endpoint):
            fail(
                f"EMULATOR_ENDPOINT is not a valid http(s) URL: {endpoint!r}",
                "set it to the Floci URL (http://localhost:4566) or remove the line for real AWS",
            )
    bucket_errors(errors, values.get("TF_STATE_BUCKET", ""), required=not is_emulator)
    return errors


def validate_bootstrap(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Narrow checks for the state-bucket bootstrap: only what bucket creation
    consumes. In particular it does not demand API_KEY or ENV_TYPE."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-south-1",
        )
    if is_emulator:
        endpoint = values["EMULATOR_ENDPOINT"]
        if not URL_RE.fullmatch(endpoint):
            fail(
                f"EMULATOR_ENDPOINT is not a valid http(s) URL: {endpoint!r}",
                "set it to the Floci URL (http://localhost:4566) or remove the line for real AWS",
            )
    bucket_errors(errors, values.get("TF_STATE_BUCKET", ""), required=not is_emulator)
    return errors


def build_tf_vars(values: dict[str, str]) -> dict[str, str]:
    is_emulator = resolve_plane(values)[1]
    tf_vars = {
        "TF_VAR_api_key": values["API_KEY"],
        "TF_VAR_aws_region": resolve_region(values),
        "TF_VAR_secret_recovery_window": str(
            EMULATOR_RECOVERY_WINDOW if is_emulator else PROD_RECOVERY_WINDOW
        ),
    }
    if (name := values.get("DP_API_KEY_SECRET_NAME")) and name != SECRETS_NAME_DEFAULT:
        tf_vars["TF_VAR_secrets_name"] = name
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = values["EMULATOR_ENDPOINT"]
    return tf_vars


def build_backend_hcl(is_emulator: bool, values: dict[str, str]) -> str:
    region = resolve_region(values)
    bucket = resolve_state_bucket(is_emulator, values)
    state_key = FLOCI_STATE_KEY if is_emulator else PROD_STATE_KEY
    if is_emulator:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{state_key}"',
            f'region                      = "{region}"',
            "encrypt                     = false",
            "skip_credentials_validation = true",
            "skip_metadata_api_check     = true",
            "skip_requesting_account_id  = true",
            "skip_region_validation      = true",
            "use_path_style              = true",
            "endpoints = {",
            f'  s3 = "{values["EMULATOR_ENDPOINT"]}"',
            "}",
        ]
    else:
        lines = [
            f'bucket                      = "{bucket}"',
            f'key                         = "{state_key}"',
            f'region                      = "{region}"',
            "encrypt                     = true",
            "use_lockfile                = true",
        ]
    return "\n".join(lines) + "\n"


def write_backend_hcl(backend_hcl: str) -> Path:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".hcl", delete=False) as handle:
        handle.write(backend_hcl)
        return Path(handle.name)


def plane_notes(values: dict[str, str], plane: str) -> list[str]:
    notes = []
    if values.get("ENV_TYPE") == "prod" and plane == "emulator (Floci)":
        notes.append("note: ENV_TYPE=prod with the emulator — the local-testing shape for the prod pull path")
    if values.get("ENV_TYPE") == "dev" and plane == "real AWS":
        notes.append("warning: applying to real AWS while ENV_TYPE=dev (dev runtime reads .env, not SM)")
    if plane == "emulator (Floci)" and not values.get("TF_STATE_BUCKET"):
        notes.append(f"note: TF_STATE_BUCKET unset; the Floci plane defaults to {FLOCI_STATE_BUCKET}")
    return notes


def warn_shell_conflicts(values: dict[str, str]) -> None:
    env_bucket = values.get("TF_STATE_BUCKET", "")
    shell_bucket = os.environ.get("TF_STATE_BUCKET")
    if env_bucket and shell_bucket and shell_bucket != env_bucket:
        print(f"note: TF_STATE_BUCKET also exported in the shell ({shell_bucket!r}); the .env value wins")


def bootstrap_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # a None bucket is a validation error, not a bootstrap input
    command_base = ["aws", "--region", resolve_region(values)]
    if is_emulator:
        command_base += ["--endpoint-url", values["EMULATOR_ENDPOINT"]]
    head_bucket = command_base + ["s3api", "head-bucket", "--bucket", bucket]
    return [
        head_bucket,
        command_base + ["s3", "mb", f"s3://{bucket}"],
        *(
            []
            if is_emulator
            else [command_base + ["s3api", "put-bucket-versioning", "--bucket", bucket,
                                  "--versioning-configuration", "Status=Enabled"]]
        ),
    ]


def run_aws(command: list[str], is_emulator: bool) -> int:
    env = os.environ | ({"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"} if is_emulator else {})
    print(f"running: {' '.join(command)}")
    try:
        return subprocess.run(command, check=False, env=env).returncode
    except OSError as exc:
        die(f"failed to run aws: {exc}", "install the AWS CLI (see README prerequisites)")


def bootstrap_state(is_emulator: bool, values: dict[str, str], dry_run: bool) -> int:
    commands = bootstrap_commands(is_emulator, values)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0

    bucket = resolve_state_bucket(is_emulator, values)
    head_result = run_aws(commands[0], is_emulator)
    if head_result == 0:
        print(f"ok:  bucket {bucket} already exists")
    else:
        if run_aws(commands[1], is_emulator) != 0:
            if is_emulator:
                print()
                print(f"fix: check that the emulator is reachable at {values['EMULATOR_ENDPOINT']} (e.g. docker start floci)")
            return 1
        print(f"created: {bucket}")
    if not is_emulator:
        bucket_put_versioning = commands[-1]
        if run_aws(bucket_put_versioning, is_emulator) != 0:
            print("fix: enable bucket versioning manually (required for terraform state safety)")
            return 1
        print("versioning: Enabled")
    return 0


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
    parser.add_argument(
        "command", choices=("plan", "apply", "bootstrap"),
        help="terraform plan/apply, or bootstrap (create the plane's state bucket via the aws CLI)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="print everything that would be fed to terraform; run nothing",
    )
    args = parser.parse_args()

    if not ENV_FILE.exists():
        die(f"{ENV_FILE} not found", "run `make env` in services/document-parser first")

    values = parse_env_file(ENV_FILE)
    plane, is_emulator = resolve_plane(values)

    if args.command == "bootstrap":
        errors = validate_bootstrap(is_emulator, values)
        for error in errors:
            print(error)
        if errors:
            return 1
        return bootstrap_state(is_emulator, values, args.dry_run)

    errors = validate(is_emulator, values)
    for error in errors:
        print(error)
    if errors:
        return 1

    tf_vars = build_tf_vars(values)
    backend_hcl = build_backend_hcl(is_emulator, values)
    warn_shell_conflicts(values)
    key_len = len(tf_vars["TF_VAR_api_key"])
    state_bucket = resolve_state_bucket(is_emulator, values)
    assert state_bucket is not None  # validation already rejected a missing bucket
    state_key = FLOCI_STATE_KEY if is_emulator else PROD_STATE_KEY

    print(f"plane:  {plane}")
    print(f"stack:  {TF_DIR}")
    print(f"secret: {SECRETS_NAME_DEFAULT}")
    print(f"key:    *** ({key_len} chars, hidden)")
    print(f"state:  {state_bucket} / {state_key}")
    for note in plane_notes(values, plane):
        print(note)

    if args.dry_run:
        print("backend overrides (written to a temp .hcl at run time):")
        for line in backend_hcl.splitlines():
            print(f"  {line}")
        print(f"commands: terraform init -reconfigure -backend-config <backend.hcl>, then terraform {args.command}")
        print("(dry run: no terraform, no AWS)")
        return 0

    backend_file = write_backend_hcl(backend_hcl)
    try:
        init_args = ["init", "-reconfigure", "-backend-config", str(backend_file)]
        verb_args = [args.command, "-input=false"]
        if args.command == "apply" and is_emulator:
            verb_args.append("-auto-approve")
        backend_creds = {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"} if is_emulator else None

        if run_terraform(init_args, tf_vars, backend_creds) != 0:
            bucket = resolve_state_bucket(is_emulator, values)
            print()
            if is_emulator:
                print("fix: create the emulator state bucket and retry (make secrets-bootstrap-state)")
                print(
                    f"fix: aws --endpoint-url {values['EMULATOR_ENDPOINT']} "
                    f"s3 mb s3://{bucket} --region {resolve_region(values)}"
                )
            else:
                print(
                    f"fix: confirm bucket {bucket} exists and your credentials allow access "
                    f"(region {resolve_region(values)}); make secrets-bootstrap-state can create it"
                )
            return 1
        return run_terraform(verb_args, tf_vars, backend_creds)
    finally:
        backend_file.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
