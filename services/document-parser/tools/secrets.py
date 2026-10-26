#!/usr/bin/env python3
"""Seed the document-parser secrets blob and config parameters from the service .env.

Input compiler only: parse and validate infra/.env, map the values onto
TF_VAR_* environment variables and a generated backend config, then drive
`terraform plan/apply` for the service-scoped stack (infra/terraform).
Non-secret runtime config rides along: an allowlist of .env keys becomes
TF_VAR_ssm_parameters, which terraform writes to SSM under
/detectai/document-parser/ — every .env key the stack knows about lands in
AWS/Floci on apply, and absent keys seed nothing.
Terraform alone touches AWS on the resource path; the script's direct AWS-API
steps are the opt-in `bootstrap` verb (create the plane's state bucket), the
`destroy --purge-state` object wipe and bucket delete, the opt-in
`--force-delete` secret delete, and the opt-in `iam-bootstrap` verb (create or
update the out-of-stack deploy role) — all via the `aws` CLI.

Plane selection (single flick, from EMULATOR_ENDPOINT in .env):
  - http(s) URL     -> Floci/LocalStack; state in the emulator's S3; auto-approved
  - unset or empty  -> real AWS; state in the TF_STATE_BUCKET bucket; confirm prompt

State bucket comes from TF_STATE_BUCKET in .env on both planes: on the emulator
an unset value falls back to the service default (detectai-docparser-tfstate)
and a missing bucket self-heals before terraform runs; real AWS requires it. `bootstrap` is the one direct AWS-API step the script performs (via the
`aws` CLI, opt-in): it creates the resolved bucket on the armed plane —
everything resource-side still goes through terraform alone. There are no
backend.*.hcl files: backend.example.hcl documents the shapes for scriptless
runs.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, NoReturn

SERVICE_DIR = Path(__file__).resolve().parents[1]
TF_DIR = SERVICE_DIR / "infra" / "terraform"
ENV_FILE = SERVICE_DIR / "infra" / ".env"

# The fixed service contract: seeding, runtime pull, and teardown all expect
# this exact name; Terraform's variables.tf keeps enforcing it.
SECRETS_NAME = "detectai/document-parser/secrets"
REGION_DEFAULT = "ap-southeast-2"
DEFAULT_STATE_BUCKET = "detectai-docparser-tfstate"
FLOCI_STATE_KEY = "document-parser/floci/terraform.tfstate"
PROD_STATE_KEY = "document-parser/terraform.tfstate"

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")
URL_RE = re.compile(r"^https?://\S+$")
# S3 naming minus dots: exactly 3-63 lowercase/digits/hyphens, alnum boundaries.
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")
API_KEY_MIN_LENGTH = 16
# The New Relic ingest key's floor: NR keys are longer, the floor just catches
# an endpoint paired with nothing at all (the runtime gate demands the same).
LICENSE_KEY_MIN_LENGTH = 16
ENV_TYPES = ("dev", "prod")
EMULATOR_RECOVERY_WINDOW = 0
PROD_RECOVERY_WINDOW = 30
STATE_PREFIX = "document-parser"

# Non-secret runtime config: .env keys terraform writes to SSM
# (SSM_SEED_PREFIX + KEY) on apply. Absent, empty or commented .env lines
# seed nothing; API_KEY and NEW_RELIC_LICENSE_KEY ride the secrets blob
# instead (TF_VAR_api_key / TF_VAR_new_relic_license_key), and pipeline keys
# (EMULATOR_ENDPOINT, AWS_REGION, ENV_TYPE, TF_STATE_BUCKET, PORT) are
# deliberately not seedable here.
SSM_SEED_PREFIX = "/detectai/document-parser/"
SSM_SEED_KEYS = (
    "UPLOAD_LIMIT_BYTES",
    "MAX_PDF_PAGES",
    "DOCX_MAX_UNCOMPRESSED_BYTES",
    "OUTPUT_CHAR_LIMIT",
    "PROCESSING_BUDGET_SECONDS",
    "HEADER_REPETITION_RATIO",
    "REPETITION_MIN_PAGES",
    "HEADER_EDGE_ZONE_RATIO",
    "EDGE_ZONE_RATIO",
    "EDGE_TOLERANCE_RATIO",
    "FOLIO_MONOTONIC_RATIO",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_SERVICE_NAME",
    "OTEL_SERVICE_VERSION",
    "OTEL_TRACE_SAMPLE_RATIO",
)

# Out-of-stack deploy identity: the role terraform runs under on real AWS.
# Created once with `iam-bootstrap` (never by terraform, so the role never has
# to manage itself). Trust: the caller's own IAM user + MFA. On the emulator
# the role is structural — nothing enforces IAM there — and a placeholder user
# keeps the document shape identical.
DEPLOY_ROLE_NAME = "detectai-document-parser-deploy"
DEPLOY_POLICY_NAME = "deploy-policy"
DEFAULT_ACCOUNT_ID = "000000000000"
DEPLOY_USER_DEFAULT = "detectai-deploy"
USER_ARN_RE = re.compile(r"^arn:aws:iam::[0-9]{12}:user/[a-zA-Z0-9+=,.@_-]+$")


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
    return DEFAULT_STATE_BUCKET if is_emulator else None


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
            "use a plain region code, e.g. ap-southeast-2",
        )
    if (env_type := values.get("ENV_TYPE")) is not None and env_type not in ENV_TYPES:
        fail(
            f"ENV_TYPE must be one of {' or '.join(ENV_TYPES)}, got {env_type!r}",
            "set ENV_TYPE=dev or ENV_TYPE=prod",
        )
    if (otel_endpoint := values.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")):
        if not URL_RE.fullmatch(otel_endpoint):
            fail(
                f"OTEL_EXPORTER_OTLP_ENDPOINT is not a valid http(s) URL: {otel_endpoint!r}",
                "use an http(s) OTLP endpoint, e.g. http://localhost:4318 (a local receiver) "
                "or https://otlp.nr-data.net (New Relic)",
            )
        # The NFR-5 gate's seed twin: a set endpoint always demands a license
        # key at runtime, so seeding one without the other would land the
        # container on a boot it cannot survive; throwaway values are fine.
        if len(values.get("NEW_RELIC_LICENSE_KEY", "")) < LICENSE_KEY_MIN_LENGTH:
            fail(
                f"NEW_RELIC_LICENSE_KEY missing or shorter than {LICENSE_KEY_MIN_LENGTH} chars "
                "while OTEL_EXPORTER_OTLP_ENDPOINT is set",
                "set the ingest license key (a throwaway value is legitimate when the "
                "endpoint is a local collector)",
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
            "use a plain region code, e.g. ap-southeast-2",
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
    # The license key rides the secrets blob like the API key: non-empty seeds,
    # absent or empty skips (the same map rule the SSM config keys follow).
    if (license_key := values.get("NEW_RELIC_LICENSE_KEY", "")) != "":
        tf_vars["TF_VAR_new_relic_license_key"] = license_key
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = values["EMULATOR_ENDPOINT"]
    # Non-secret config rides along to SSM; absent or empty keys seed nothing
    # (an empty map is terraform's own default, seeding zero parameters).
    config = {key: values[key] for key in SSM_SEED_KEYS if values.get(key, "") != ""}
    if config:
        tf_vars["TF_VAR_ssm_parameters"] = json.dumps(config)
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
        notes.append(f"note: TF_STATE_BUCKET unset; the Floci plane defaults to {DEFAULT_STATE_BUCKET}")
    return notes


def warn_shell_conflicts(values: dict[str, str]) -> None:
    env_bucket = values.get("TF_STATE_BUCKET", "")
    shell_bucket = os.environ.get("TF_STATE_BUCKET")
    if env_bucket and shell_bucket and shell_bucket != env_bucket:
        print(f"note: TF_STATE_BUCKET also exported in the shell ({shell_bucket!r}); the .env value wins")


def aws_base(is_emulator: bool, values: dict[str, str]) -> list[str]:
    base = ["aws", "--region", resolve_region(values)]
    if is_emulator:
        base += ["--endpoint-url", values["EMULATOR_ENDPOINT"]]
    return base


def bootstrap_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # a None bucket is a validation error, not a bootstrap input
    command_base = aws_base(is_emulator, values)
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


def aws_env(is_emulator: bool) -> dict[str, str]:
    return os.environ | ({"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"} if is_emulator else {})


def run_aws(command: list[str], is_emulator: bool) -> int:
    print(f"running: {' '.join(command)}")
    try:
        return subprocess.run(command, check=False, env=aws_env(is_emulator)).returncode
    except OSError as exc:
        die(f"failed to run aws: {exc}", "install the AWS CLI (see README prerequisites)")


def run_aws_captured(command: list[str], is_emulator: bool) -> tuple[int, str, str]:
    """Like run_aws but keeps the streams captured: (returncode, stdout, stderr)."""
    try:
        process = subprocess.run(command, check=False, env=aws_env(is_emulator), capture_output=True, text=True)
        return process.returncode, process.stdout, process.stderr
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


def ensure_state_bucket(is_emulator: bool, values: dict[str, str]) -> int:
    """Emulator-only self-heal: the local emulator loses its S3 data on restart,
    so any terraform verb may start against a missing bucket — recreate it with
    the default name instead of failing. Real AWS keeps its explicit, required
    bucket; auto-creating one on a prod account is never the script's call."""
    if not is_emulator:
        return 0
    bucket = resolve_state_bucket(True, values)  # the fallback keeps this resolvable
    assert bucket is not None
    head = run_aws_captured(aws_base(True, values) + ["s3api", "head-bucket", "--bucket", bucket], True)
    if head[0] == 0:
        return 0
    print(f"note: emulator state bucket {bucket} is missing; creating it")
    return bootstrap_state(True, values, False)


def force_delete_command(is_emulator: bool, values: dict[str, str]) -> list[str]:
    return aws_base(is_emulator, values) + [
        "secretsmanager", "delete-secret",
        "--secret-id", SECRETS_NAME,
        "--force-delete-without-recovery",
    ]


def resolve_trust_user_arn(is_emulator: bool, values: dict[str, str]) -> str:
    """Deploy role trust: the caller's own IAM user on real AWS (mandatory), a
    documented placeholder on the emulator (nothing enforces IAM there)."""
    if is_emulator:
        user_arn = values.get("DEPLOY_TRUST_USER_ARN", "")
        if user_arn:
            return user_arn
        return f"arn:aws:iam::{DEFAULT_ACCOUNT_ID}:user/{DEPLOY_USER_DEFAULT}"
    return values["DEPLOY_TRUST_USER_ARN"]


def iam_account_id(user_arn: str) -> str:
    assert USER_ARN_RE.fullmatch(user_arn) is not None  # validate_iam_bootstrap guards both planes
    return user_arn.split(":")[4]


def validate_iam_bootstrap(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Narrow checks for the deploy-role bootstrap: region, emulator endpoint,
    the state bucket (its ARN is embedded in the policy) and the trust user."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid region: {region!r}",
            "use a plain region code, e.g. ap-southeast-2",
        )
    if is_emulator:
        endpoint = values["EMULATOR_ENDPOINT"]
        if not URL_RE.fullmatch(endpoint):
            fail(
                f"EMULATOR_ENDPOINT is not a valid http(s) URL: {endpoint!r}",
                "set it to the Floci URL (http://localhost:4566) or remove the line for real AWS",
            )
    bucket_errors(errors, values.get("TF_STATE_BUCKET", ""), required=not is_emulator)
    user_arn = values.get("DEPLOY_TRUST_USER_ARN", "")
    bad_arn = f"DEPLOY_TRUST_USER_ARN is not a plain IAM user ARN: {user_arn!r}"
    bad_arn_fix = "set DEPLOY_TRUST_USER_ARN=arn:aws:iam::<account-id>:user/<your-user> in .env"
    if not is_emulator and not USER_ARN_RE.fullmatch(user_arn):
        fail(bad_arn + " (missing on the real-AWS plane)", bad_arn_fix)
    elif user_arn and not USER_ARN_RE.fullmatch(user_arn):
        fail(bad_arn, bad_arn_fix)
    return errors


def deploy_trust_document(user_arn: str) -> dict[str, Any]:
    """The deploy setup runs on purpose-built credentials, not personal keys:
    the caller (or CI later) assumes this role under MFA."""
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"AWS": user_arn},
                "Action": "sts:AssumeRole",
                "Condition": {"Bool": {"aws:MultiFactorAuthPresent": "true"}},
            }
        ],
    }


def deploy_policy_document(is_emulator: bool, values: dict[str, str], user_arn: str) -> dict[str, Any]:
    """Least-privilege deploy scope, service-pinned on every ARN: this
    service's state bucket, secret blob, SSM config prefix, and the runtime
    role it administers (the runtime role is in-stack, so terraform under this
    identity must be able to create and shape it)."""
    region = resolve_region(values)
    account = iam_account_id(user_arn)
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # validation already rejected a missing bucket
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "RunTerraformStateBucket",
                "Effect": "Allow",
                "Action": [
                    "s3:CreateBucket", "s3:PutBucketVersioning", "s3:GetBucketVersioning",
                    "s3:ListBucket", "s3:ListBucketVersions", "s3:DeleteBucket",
                ],
                "Resource": [f"arn:aws:s3:::{bucket}"],
            },
            {
                "Sid": "RunTerraformStateObjects",
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject", "s3:DeleteObject"],
                "Resource": [f"arn:aws:s3:::{bucket}/*"],
            },
            {
                "Sid": "ManageServiceSecret",
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue",
                    "secretsmanager:UpdateSecret", "secretsmanager:DeleteSecret",
                    "secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue",
                    "secretsmanager:TagResource",
                ],
                "Resource": [f"arn:aws:secretsmanager:{region}:{account}:secret:detectai/document-parser/secrets-*"],
            },
            {
                "Sid": "ManageServiceConfig",
                "Effect": "Allow",
                "Action": [
                    "ssm:PutParameter", "ssm:DeleteParameter", "ssm:GetParameter",
                    "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:AddTagsToResource",
                ],
                "Resource": [f"arn:aws:ssm:{region}:{account}:parameter{SSM_SEED_PREFIX}*"],
            },
            {
                "Sid": "ManageRuntimeRole",
                "Effect": "Allow",
                "Action": [
                    "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PutRolePolicy",
                    "iam:GetRolePolicy", "iam:DeleteRolePolicy", "iam:TagRole",
                ],
                "Resource": [f"arn:aws:iam::{account}:role/detectai-document-parser"],
            },
        ],
    }


def iam_bootstrap_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    user_arn = resolve_trust_user_arn(is_emulator, values)
    base = aws_base(is_emulator, values)
    return [
        base + ["iam", "create-role", "--role-name", DEPLOY_ROLE_NAME,
                "--assume-role-policy-document", json.dumps(deploy_trust_document(user_arn))],
        base + ["iam", "put-role-policy", "--role-name", DEPLOY_ROLE_NAME,
                "--policy-name", DEPLOY_POLICY_NAME,
                "--policy-document", json.dumps(deploy_policy_document(is_emulator, values, user_arn))],
    ]


def confirm_iam_bootstrap(user_arn: str) -> bool:
    answer = input(
        f'type "{DEPLOY_ROLE_NAME}" to create or update it (trust: {user_arn}): '
    ).strip()
    if answer != DEPLOY_ROLE_NAME:
        print("cancelled: the deploy role is untouched")
        return False
    return True


def iam_bootstrap_flow(is_emulator: bool, values: dict[str, str], dry_run: bool) -> int:
    """Create or update the deploy identity: idempotent (an existing role is
    kept, the inline policy is always refreshed). The emulator plane runs
    unattended; real AWS requires a typed barrier first."""
    user_arn = resolve_trust_user_arn(is_emulator, values)
    print(f"plane:  {'emulator (Floci)' if is_emulator else 'real AWS'}")
    print(f"role:   {DEPLOY_ROLE_NAME} (out-of-stack deploy identity)")
    print(f"trust:  {user_arn} (MFA required)")
    commands = iam_bootstrap_commands(is_emulator, values)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    if not is_emulator and not confirm_iam_bootstrap(user_arn):
        return 1

    code, _, stderr = run_aws_captured(commands[0], is_emulator)
    if code == 0:
        print(f"created: {DEPLOY_ROLE_NAME}")
    elif "EntityAlreadyExists" in (stderr or ""):
        print(f"ok: role {DEPLOY_ROLE_NAME} already exists")
    else:
        print("error: create-role failed")
        if (stderr or "").strip():
            print(stderr.strip())
        return 1

    if run_aws(commands[1], is_emulator) != 0:
        print(f"fix: inspect the role and attach {DEPLOY_POLICY_NAME} manually, then retry")
        return 1
    scopes = ", ".join(statement["Sid"] for statement in deploy_policy_document(is_emulator, values, user_arn)["Statement"])
    print(f"policy: {DEPLOY_POLICY_NAME} attached ({scopes})")
    print("next:   assume this role for real-aws terraform runs instead of personal keys")
    return 0


def deploy_role_exists(is_emulator: bool, values: dict[str, str]) -> bool:
    code, _, _ = run_aws_captured(
        aws_base(is_emulator, values) + ["iam", "get-role", "--role-name", DEPLOY_ROLE_NAME],
        is_emulator,
    )
    return code == 0


def drop_iam_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    base = aws_base(is_emulator, values)
    return [
        base + ["iam", "delete-role-policy", "--role-name", DEPLOY_ROLE_NAME,
                "--policy-name", DEPLOY_POLICY_NAME],
        base + ["iam", "delete-role", "--role-name", DEPLOY_ROLE_NAME],
    ]


def drop_iam_flow(is_emulator: bool, values: dict[str, str], dry_run: bool) -> int:
    """Remove the deploy identity: policy first, then the role. A missing role
    is an already-gone no-op; the untouched shapes make the wipe repeatable.
    The emulator plane drops unattended; real AWS demands the same typed
    barrier as the purge wipe."""
    commands = drop_iam_commands(is_emulator, values)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    if not deploy_role_exists(is_emulator, values):
        print(f"ok: role {DEPLOY_ROLE_NAME} does not exist; nothing to drop")
        return 0
    if not is_emulator:
        answer = input(f'type "{DEPLOY_ROLE_NAME}" to detach its policy and delete the role: ').strip()
        if answer != DEPLOY_ROLE_NAME:
            print("cancelled: the deploy role is untouched")
            return 1
    if run_aws(commands[0], is_emulator) != 0:
        print(f"fix: detach {DEPLOY_POLICY_NAME} manually, then rerun (an existing policy is overwritten by reruns)")
        return 1
    print(f"detached: {DEPLOY_POLICY_NAME}")
    if run_aws(commands[1], is_emulator) != 0:
        print("fix: delete the role manually once its inline policies are gone")
        return 1
    print(f"deleted: {DEPLOY_ROLE_NAME}")
    return 0


def list_bucket_versions(is_emulator: bool, values: dict[str, str]) -> list[tuple[str, str]] | None:
    """Every (key, version id) — object versions and delete markers — in the
    plane's state bucket, or None when the listing failed. The AWS CLI
    paginates automatically, so one call spans the whole bucket."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # a None bucket is a validation error, not a listing input
    code, stdout, stderr = run_aws_captured(
        aws_base(is_emulator, values)
        + ["s3api", "list-object-versions", "--bucket", bucket, "--output", "json"],
        is_emulator,
    )
    if code != 0:
        print(f"error: could not list object versions in {bucket}")
        if stderr.strip():
            print(stderr.strip())
        return None
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        print(f"error: list-object-versions returned unparseable output: {exc}")
        return None
    items = []
    for kind in ("Versions", "DeleteMarkers"):
        for entry in payload.get(kind) or []:
            items.append((entry["Key"], entry["VersionId"]))
    return items


def confirm_purge(is_emulator: bool, values: dict[str, str]) -> bool:
    """Typed barrier against wiping the state bucket — Terraform does not
    manage it, so its own destroy prompt never covers the wipe. Runs before
    any destruction so a refusal leaves everything intact."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # validation already rejected a missing bucket
    if run_aws(aws_base(is_emulator, values) + ["s3api", "head-bucket", "--bucket", bucket], is_emulator) != 0:
        print(f"note: bucket {bucket} does not exist; the purge step will be a no-op")
        return True
    items = list_bucket_versions(is_emulator, values) or []
    if items:
        print(f"purge will wipe {len(items)} object version(s) in {bucket}")
        prefixes = sorted({key.split("/", 1)[0] for key, _ in items})
        others = [prefix for prefix in prefixes if prefix != STATE_PREFIX]
        if others:
            print(
                f"warning: {bucket} also holds objects outside {STATE_PREFIX}/ "
                f"(prefixes: {', '.join(others)}); deleting the bucket removes them too"
            )
    if is_emulator:
        print(f"note: emulator plane purges {bucket} without a typed confirmation (auto-apply plane)")
        return True
    answer = input(f'type "{bucket}" to wipe it and delete it: ').strip()
    if answer != bucket:
        print("cancelled: nothing was destroyed")
        return False
    return True


def purge_state(is_emulator: bool, values: dict[str, str]) -> int:
    """Wipe every object version and delete marker from the plane's state
    bucket, then delete the bucket. Runs only after a successful terraform
    destroy — the ledger must not be needed again once this succeeds. Safe to
    rerun: a missing bucket is reported as a no-op."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # validation already rejected a missing bucket
    base = aws_base(is_emulator, values)
    if run_aws(base + ["s3api", "head-bucket", "--bucket", bucket], is_emulator) != 0:
        print(f"note: bucket {bucket} is already gone; nothing to purge")
        return 0
    items = list_bucket_versions(is_emulator, values)
    if items is None:
        return 1
    if not items:
        print(f"purge: {bucket} holds no objects")
    for key, version_id in items:
        print(f"purging: {key}")
        delete = base + ["s3api", "delete-object", "--bucket", bucket,
                         "--key", key, "--version-id", version_id]
        if run_aws(delete, is_emulator) != 0:
            return 1
    if run_aws(base + ["s3api", "delete-bucket", "--bucket", bucket], is_emulator) != 0:
        print("fix: rerun `make secrets-destroy` — safe to repeat when the deletions are still settling")
        return 1
    print(f"deleted: {bucket}")
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
        "command", choices=("plan", "apply", "bootstrap", "destroy", "iam-bootstrap"),
        help="terraform plan/apply/destroy, bootstrap (create the plane's state bucket via the aws CLI), "
             "or iam-bootstrap (create/update the out-of-stack deploy role via the aws CLI)",
    )
    parser.add_argument(
        "--purge-state", action="store_true",
        help="destroy only: after terraform destroy, wipe and delete the plane's state bucket",
    )
    parser.add_argument(
        "--force-delete", action="store_true",
        help="destroy only: delete the secret immediately after destroy, skipping the 30-day recovery window on real AWS",
    )
    parser.add_argument(
        "--drop-iam", action="store_true",
        help="destroy only: after terraform destroy, drop the out-of-stack deploy role "
             "(detach its inline policy, then delete the role)",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="print everything that would be fed to terraform; run nothing",
    )
    args = parser.parse_args()

    if args.purge_state and args.command != "destroy":
        die("--purge-state only applies to the destroy command",
            "run it with destroy (make secrets-destroy)")
    if args.force_delete and args.command != "destroy":
        die("--force-delete only applies to the destroy command",
            "run it with destroy (poetry run python tools/secrets.py destroy --force-delete)")
    if args.drop_iam and args.command != "destroy":
        die("--drop-iam only applies to the destroy command",
            "run it with destroy (make secrets-destroy)")

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

    if args.command == "iam-bootstrap":
        errors = validate_iam_bootstrap(is_emulator, values)
        for error in errors:
            print(error)
        if errors:
            return 1
        return iam_bootstrap_flow(is_emulator, values, args.dry_run)

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
    print(f"secret: {SECRETS_NAME}")
    print(f"key:    *** ({key_len} chars, hidden)")
    print(f"state:  {state_bucket} / {state_key}")
    config_keys = [key for key in SSM_SEED_KEYS if values.get(key, "") != ""]
    if config_keys:
        print(f"config: {len(config_keys)} key(s) -> SSM {SSM_SEED_PREFIX}")
    for note in plane_notes(values, plane):
        print(note)

    if args.dry_run:
        print("backend overrides (written to a temp .hcl at run time):")
        for line in backend_hcl.splitlines():
            print(f"  {line}")
        print(f"commands: terraform init -reconfigure -backend-config <backend.hcl>, then terraform {args.command}")
        if args.command == "destroy":
            if args.force_delete:
                if is_emulator:
                    print("then skip: --force-delete has no effect on the emulator (0-day recovery window)")
                else:
                    print(f"then run: {' '.join(force_delete_command(is_emulator, values))}")
            if args.purge_state:
                print(f"then purge: every object version in {state_bucket}, then delete the bucket")
            if args.drop_iam:
                print(f"then drop: {DEPLOY_POLICY_NAME} and the {DEPLOY_ROLE_NAME} role")
        print("(dry run: no terraform, no AWS)")
        return 0

    # The typed barrier gates the whole destroy run: purging removes the bucket
    # terraform does not manage, and a refusal after destroy would strand the
    # plane deliberately wiped with no ledger to re-apply from.
    if args.command == "destroy" and args.purge_state and not confirm_purge(is_emulator, values):
        return 1

    # A dropped emulator bucket (in-memory data, restart-prone) heals itself;
    # real AWS keeps failing loudly on its missing explicit bucket.
    if ensure_state_bucket(is_emulator, values) != 0:
        return 1

    backend_file = write_backend_hcl(backend_hcl)
    try:
        init_args = ["init", "-reconfigure", "-backend-config", str(backend_file)]
        # -input=false disables ALL prompts, including the apply approval; real AWS
        # must keep its confirm prompt, so it applies without the flag.
        verb_args = [args.command]
        if args.command == "plan" or is_emulator:
            verb_args.append("-input=false")
        if args.command in ("apply", "destroy") and is_emulator:
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
        destroyed = run_terraform(verb_args, tf_vars, backend_creds)
        if args.command != "destroy" or destroyed != 0:
            return destroyed
        if args.force_delete:
            if is_emulator:
                print("note: --force-delete has no effect on the emulator (0-day recovery window)")
            else:
                run_aws(force_delete_command(is_emulator, values), is_emulator)
        # The wipe chain runs only after terraform succeeded: bucket purge, then
        # the deploy role — a destroyed ledger and a surviving identity would
        # strand the plane half-clean on purpose, otherwise.
        if args.purge_state and purge_state(is_emulator, values) != 0:
            return 1
        if args.drop_iam:
            return drop_iam_flow(is_emulator, values, args.dry_run)
        return 0
    finally:
        backend_file.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
