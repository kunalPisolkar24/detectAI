#!/usr/bin/env python3
"""Seed the document-parser secrets blob and config parameters from the service .env.

Compiles infra/.env into TF_VAR_* variables and a generated backend config,
then drives `terraform plan/apply` for the service-scoped stack. The plane
comes from EMULATOR_ENDPOINT: an http(s) URL -> Floci/LocalStack
(auto-approved), unset -> real AWS (confirm prompt). Terraform alone touches
AWS on the resource path; the opt-in direct-AWS verbs are `bootstrap`
(state bucket), `destroy --purge-state` / `--force-delete`, `seeder-bootstrap`.

On real AWS the seeder identity is zero-config: the trust principal is
auto-detected from the ambient caller (or pinned via SEEDER_TRUST_USER_ARN),
and every carrier verb runs under a one-hour MFA-gated session of the
detectai-document-parser-seeder role, cached in infra/.aws-session.json between
verbs. The emulator keeps fake credentials and never assumes anything.
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
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NoReturn

SERVICE_DIR = Path(__file__).resolve().parents[1]
TF_DIR = SERVICE_DIR / "infra" / "terraform"
ENV_FILE = SERVICE_DIR / "infra" / ".env"

# Fixed contract name: seeding, runtime pull, and teardown all expect it.
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
# The runtime gate's floor twin; catches an endpoint paired with nothing at all.
LICENSE_KEY_MIN_LENGTH = 16
ENV_TYPES = ("dev", "prod")
EMULATOR_RECOVERY_WINDOW = 0
PROD_RECOVERY_WINDOW = 30
RECOVERY_WINDOW_MIN = 7
RECOVERY_WINDOW_MAX = 30
STATE_PREFIX = "document-parser"

# Non-secret runtime config terraform writes to SSM (SSM_SEED_PREFIX + KEY) on
# apply. Absent or empty .env keys seed nothing; API_KEY and
# NEW_RELIC_LICENSE_KEY ride the secrets blob instead, and pipeline keys are
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

# Out-of-stack seeder identity terraform never manages: the single carrier for
# state-bucket, Secrets Manager, and SSM writes. Its trust principal is
# auto-detected from the ambient caller (or pinned via SEEDER_TRUST_USER_ARN)
# and always requires MFA; carrier verbs run under assumed seeder sessions.
SEEDER_ROLE_NAME = "detectai-document-parser-seeder"
SEEDER_POLICY_NAME = "seeder-policy"
DEFAULT_ACCOUNT_ID = "000000000000"
SEEDER_USER_DEFAULT = "detectai-seeder"
USER_ARN_RE = re.compile(r"^arn:aws:iam::[0-9]{12}:user/[a-zA-Z0-9+=,.@_-]+$")

# Real-plane carrier session: every carrier verb assumes the seeder role with
# the caller's MFA, for one hour. The triplet is cached in a gitignored file
# beside .env (chmod 600) so a multi-verb stretch prompts for the code once;
# it is refreshed once less than the renewal margin remains.
SEEDER_MFA_SERIAL_KEY = "SEEDER_MFA_SERIAL"
SESSION_CACHE_FILE = SERVICE_DIR / "infra" / ".aws-session.json"
SESSION_DURATION_SECONDS = 3600
SESSION_RENEWAL_MARGIN_SECONDS = 10 * 60
SEEDER_ROLE_SESSION_MARK = f"assumed-role/{SEEDER_ROLE_NAME}/"
MFA_CODE_RE = re.compile(r"^[0-9]{6}$")


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
    """The .env value, or the Floci default; real AWS stays explicit."""
    bucket = values.get("TF_STATE_BUCKET", "")
    if bucket:
        return bucket
    return DEFAULT_STATE_BUCKET if is_emulator else None


def resolve_recovery_window(is_emulator: bool, values: dict[str, str]) -> int:
    """Emulator plane: always 0. Real AWS: the .env override or the 30-day default."""
    if is_emulator:
        return EMULATOR_RECOVERY_WINDOW
    raw = values.get("SECRET_RECOVERY_WINDOW", "")
    if not raw:
        return PROD_RECOVERY_WINDOW
    return int(raw)


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


def plane_errors(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Region and endpoint checks shared by every verb validator."""
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
    return errors


def validate(is_emulator: bool, values: dict[str, str]) -> list[str]:
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if len(values.get("API_KEY", "")) < API_KEY_MIN_LENGTH:
        fail(
            f"API_KEY missing or shorter than {API_KEY_MIN_LENGTH} chars in {ENV_FILE}",
            "set a real key, e.g. API_KEY=<at least 16 chars>",
        )
    if (env_type := values.get("ENV_TYPE")) is not None and env_type not in ENV_TYPES:
        fail(
            f"ENV_TYPE must be one of {' or '.join(ENV_TYPES)}, got {env_type!r}",
            "set ENV_TYPE=dev or ENV_TYPE=prod",
        )
    if (raw := values.get("SECRET_RECOVERY_WINDOW", "")) and not is_emulator:
        # The emulator ignores the key outright, so only the real plane polices it.
        parsed = int(raw) if raw.isdigit() else None
        if parsed is None:
            fail(
                f"SECRET_RECOVERY_WINDOW is not a whole number of days: {raw!r}",
                "use 0 (drop the secret at destroy time) or 7-30 (keep the AWS window)",
            )
        elif parsed != 0 and not RECOVERY_WINDOW_MIN <= parsed <= RECOVERY_WINDOW_MAX:
            fail(
                f"SECRET_RECOVERY_WINDOW must be 0 or between 7 and 30, got {raw}",
                f"Secrets Manager accepts 0 or {RECOVERY_WINDOW_MIN}-{RECOVERY_WINDOW_MAX}; "
                "the terraform variable enforces the same rule",
            )
    if (otel_endpoint := values.get("OTEL_EXPORTER_OTLP_ENDPOINT", "")):
        if not URL_RE.fullmatch(otel_endpoint):
            fail(
                f"OTEL_EXPORTER_OTLP_ENDPOINT is not a valid http(s) URL: {otel_endpoint!r}",
                "use an http(s) OTLP endpoint, e.g. http://localhost:4318 (a local receiver) "
                "or https://otlp.nr-data.net (New Relic)",
            )
        # Seed twin of the runtime gate: a keyless endpoint would boot unfixably.
        if len(values.get("NEW_RELIC_LICENSE_KEY", "")) < LICENSE_KEY_MIN_LENGTH:
            fail(
                f"NEW_RELIC_LICENSE_KEY missing or shorter than {LICENSE_KEY_MIN_LENGTH} chars "
                "while OTEL_EXPORTER_OTLP_ENDPOINT is set",
                "set the ingest license key (a throwaway value is legitimate when the "
                "endpoint is a local collector)",
            )
    errors.extend(plane_errors(is_emulator, values))
    bucket_errors(errors, values.get("TF_STATE_BUCKET", ""), required=not is_emulator)
    return errors


def validate_bootstrap(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Only what bucket creation consumes; no API_KEY or ENV_TYPE demands."""
    errors: list[str] = []
    errors.extend(plane_errors(is_emulator, values))
    bucket_errors(errors, values.get("TF_STATE_BUCKET", ""), required=not is_emulator)
    return errors


def build_tf_vars(values: dict[str, str]) -> dict[str, str]:
    is_emulator = resolve_plane(values)[1]
    tf_vars = {
        "TF_VAR_api_key": values["API_KEY"],
        "TF_VAR_aws_region": resolve_region(values),
        "TF_VAR_secret_recovery_window": str(resolve_recovery_window(is_emulator, values)),
    }
    # License key rides the secrets blob: non-empty seeds, empty skips.
    if (license_key := values.get("NEW_RELIC_LICENSE_KEY", "")) != "":
        tf_vars["TF_VAR_new_relic_license_key"] = license_key
    if is_emulator:
        tf_vars["TF_VAR_emulator_endpoint"] = values["EMULATOR_ENDPOINT"]
    # Non-secret config rides the SSM map; absent or empty seeds nothing.
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
    if values.get("SECRET_RECOVERY_WINDOW"):
        if plane == "emulator (Floci)":
            notes.append("note: SECRET_RECOVERY_WINDOW ignored on the emulator plane (always 0)")
        elif values["SECRET_RECOVERY_WINDOW"] == "0":
            notes.append("warning: SECRET_RECOVERY_WINDOW=0 on real AWS — destroy deletes the secret immediately")
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


def aws_env(is_emulator: bool, session: dict[str, str] | None = None) -> dict[str, str]:
    """Subprocess credentials: the emulator fakes or a cached seeder session
    triplet as env creds (they outrank any named profile, which the CLI resolves
    first), or the ambient environment untouched."""
    env = dict(os.environ)
    if is_emulator:
        env.pop("AWS_PROFILE", None)
        env |= {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
    elif session:
        env.pop("AWS_PROFILE", None)
        env |= {
            "AWS_ACCESS_KEY_ID": session["access_key_id"],
            "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
            "AWS_SESSION_TOKEN": session["session_token"],
        }
    return env


def run_aws(command: list[str], is_emulator: bool, session: dict[str, str] | None = None) -> int:
    print(f"running: {' '.join(command)}")
    try:
        return subprocess.run(command, check=False, env=aws_env(is_emulator, session)).returncode
    except OSError as exc:
        die(f"failed to run aws: {exc}", "install the AWS CLI (see README prerequisites)")


def run_aws_captured(command: list[str], is_emulator: bool, session: dict[str, str] | None = None) -> tuple[int, str, str]:
    """Like run_aws but keeps the streams captured: (returncode, stdout, stderr)."""
    try:
        process = subprocess.run(command, check=False, env=aws_env(is_emulator, session), capture_output=True, text=True)
        return process.returncode, process.stdout, process.stderr
    except OSError as exc:
        die(f"failed to run aws: {exc}", "install the AWS CLI (see README prerequisites)")


def bootstrap_state(is_emulator: bool, values: dict[str, str], dry_run: bool, session: dict[str, str] | None = None) -> int:
    commands = bootstrap_commands(is_emulator, values)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0

    bucket = resolve_state_bucket(is_emulator, values)
    head_result = run_aws(commands[0], is_emulator, session)
    if head_result == 0:
        print(f"ok:  bucket {bucket} already exists")
    else:
        if run_aws(commands[1], is_emulator, session) != 0:
            if is_emulator:
                print()
                print(f"fix: check that the emulator is reachable at {values['EMULATOR_ENDPOINT']} (e.g. docker start floci)")
            return 1
        print(f"created: {bucket}")
    if not is_emulator:
        bucket_put_versioning = commands[-1]
        if run_aws(bucket_put_versioning, is_emulator, session) != 0:
            print("fix: enable bucket versioning manually (required for terraform state safety)")
            return 1
        print("versioning: Enabled")
    return 0


def ensure_state_bucket(is_emulator: bool, values: dict[str, str]) -> int:
    """Emulator-only self-heal: the emulator loses its S3 data on restart, so
    any verb may start against a missing bucket."""
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


def resolve_trust_principal(is_emulator: bool, values: dict[str, str]) -> str:
    """The IAM principal the seeder role trusts: the pinned user ARN, else the
    ambient caller on real AWS, else the structural emulator placeholder."""
    if is_emulator:
        return values.get("SEEDER_TRUST_USER_ARN", "") or f"arn:aws:iam::{DEFAULT_ACCOUNT_ID}:user/{SEEDER_USER_DEFAULT}"
    override = values.get("SEEDER_TRUST_USER_ARN", "")
    if override:
        if not USER_ARN_RE.fullmatch(override):
            die(
                f"SEEDER_TRUST_USER_ARN is not a plain IAM user ARN: {override!r}",
                "set arn:aws:iam::<account-id>:user/<your-user> in .env, or remove the line for auto-detection",
            )
        return override
    _, caller_arn = sts_caller_identity()
    if SEEDER_ROLE_SESSION_MARK in caller_arn:
        die(
            f"the ambient credentials are already a {SEEDER_ROLE_NAME} session ({caller_arn})",
            "unset the exported AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN and run "
            "under your personal credentials (make secrets-session-clear drops the local cache)",
        )
    if caller_arn.endswith(":root"):
        die(
            f"the caller is the account root ({caller_arn}); root sessions cannot satisfy an "
            "MFA-gated assume-role",
            "set SEEDER_TRUST_USER_ARN=arn:aws:iam::<account-id>:user/<your-user> in .env",
        )
    if ":assumed-role/" in caller_arn:
        stripped = role_arn_of_session(caller_arn)
        print(f"note: caller is a role session ({caller_arn}); its base role becomes the trust principal: {stripped}")
        return stripped
    return caller_arn


def sts_caller_identity() -> tuple[str, str]:
    """The caller's account id and ARN under ambient credentials (env, profile,
    or SSO — whatever the aws CLI resolves)."""
    command = ["aws", "sts", "get-caller-identity", "--output", "json"]
    code, stdout, stderr = run_aws_captured(command, False)
    if code != 0:
        detail = (stderr or "").strip().splitlines()[-1] if (stderr or "").strip() else ""
        die(
            "could not resolve your ambient AWS identity (sts get-caller-identity failed)",
            f"check that personal credentials are available to the aws CLI: {' '.join(command)} {detail}",
        )
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        die(f"could not parse the get-caller-identity output: {exc}", "rerun the verb")
    caller_arn, account_id = payload.get("Arn", ""), payload.get("Account", "")
    if not caller_arn or not account_id:
        die("the get-caller-identity response lacks Arn/Account", "rerun the verb")
    return str(account_id), str(caller_arn)


def role_arn_of_session(caller_arn: str) -> str:
    """arn:aws:sts::A:assumed-role/[path/]Role/session -> arn:aws:iam::A:role/[path/]Role."""
    identity = caller_arn.split(":assumed-role/", 1)[1]
    account_id = caller_arn.split(":")[4]
    segments = identity.split("/")
    return f"arn:aws:iam::{account_id}:role/{'/'.join(segments[:-1])}"


def seeder_role_arn(account_id: str) -> str:
    return f"arn:aws:iam::{account_id}:role/{SEEDER_ROLE_NAME}"


def iam_account_id(principal: str) -> str:
    if not principal.startswith("arn:aws:iam::"):
        die(f"not an IAM principal ARN: {principal!r}", "trust the seeder role to an arn:aws:iam::<account> ARN")
    return principal.split(":")[4]


def mfa_serial_for(principal: str, override: str) -> str | None:
    """The caller's MFA device: the override, else derived from a plain user
    ARN. None when the principal is not an MFA-capable IAM user."""
    if override:
        return override
    if USER_ARN_RE.fullmatch(principal):
        account_id = principal.split(":")[4]
        return f"arn:aws:iam::{account_id}:mfa/{principal.split(':user/', 1)[1]}"
    return None


def validate_seeder_bootstrap(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Only what the bootstrap consumes: region, endpoint, bucket, trust user."""
    errors: list[str] = []
    errors.extend(plane_errors(is_emulator, values))
    bucket_errors(errors, values.get("TF_STATE_BUCKET", ""), required=not is_emulator)
    user_arn = values.get("SEEDER_TRUST_USER_ARN", "")
    if user_arn and not USER_ARN_RE.fullmatch(user_arn):
        errors.append(
            f"error: SEEDER_TRUST_USER_ARN is not a plain IAM user ARN: {user_arn!r}\n"
            "fix:   set SEEDER_TRUST_USER_ARN=arn:aws:iam::<account-id>:user/<your-user> in .env "
            "(leave it unset for auto-detection)"
        )
    return errors


def validate_seeder_role(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Only what role drop/delete consumes: region and endpoint."""
    return plane_errors(is_emulator, values)


def seeder_trust_document(user_arn: str) -> dict[str, Any]:
    """The seeding runs under this role with MFA, never personal keys."""
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


def seeder_policy_document(is_emulator: bool, values: dict[str, str], user_arn: str) -> dict[str, Any]:
    """Least privilege, service-pinned on every ARN: state, blob, and config writes only."""
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
        ],
    }


def seeder_bootstrap_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    user_arn = resolve_trust_principal(is_emulator, values)
    base = aws_base(is_emulator, values)
    return [
        base + ["iam", "create-role", "--role-name", SEEDER_ROLE_NAME,
                "--assume-role-policy-document", json.dumps(seeder_trust_document(user_arn))],
        base + ["iam", "put-role-policy", "--role-name", SEEDER_ROLE_NAME,
                "--policy-name", SEEDER_POLICY_NAME,
                "--policy-document", json.dumps(seeder_policy_document(is_emulator, values, user_arn))],
    ]


def confirm_seeder_bootstrap(user_arn: str) -> bool:
    answer = input(
        f'type "{SEEDER_ROLE_NAME}" to create or update it (trust: {user_arn}): '
    ).strip()
    if answer != SEEDER_ROLE_NAME:
        print("cancelled: the seeder role is untouched")
        return False
    return True


def seeder_bootstrap_flow(is_emulator: bool, values: dict[str, str], dry_run: bool) -> int:
    """Idempotent create/update; emulator runs unattended, real AWS asks a typed barrier."""
    user_arn = resolve_trust_principal(is_emulator, values)
    print(f"plane:  {'emulator (Floci)' if is_emulator else 'real AWS'}")
    print(f"role:   {SEEDER_ROLE_NAME} (out-of-stack seeder identity)")
    print(f"trust:  {user_arn} (MFA required)")
    commands = seeder_bootstrap_commands(is_emulator, values)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    if not is_emulator and not confirm_seeder_bootstrap(user_arn):
        return 1

    code, _, stderr = run_aws_captured(commands[0], is_emulator)
    if code == 0:
        print(f"created: {SEEDER_ROLE_NAME}")
    elif "EntityAlreadyExists" in (stderr or ""):
        print(f"ok: role {SEEDER_ROLE_NAME} already exists")
    else:
        print("error: create-role failed")
        if (stderr or "").strip():
            print(stderr.strip())
        return 1

    if run_aws(commands[1], is_emulator) != 0:
        print(f"fix: inspect the role and attach {SEEDER_POLICY_NAME} manually, then retry")
        return 1
    scopes = ", ".join(statement["Sid"] for statement in seeder_policy_document(is_emulator, values, user_arn)["Statement"])
    print(f"policy: {SEEDER_POLICY_NAME} attached ({scopes})")
    print("next:   carrier verbs assume this role automatically with your MFA code (one prompt per hour window)")
    return 0


def seeder_role_exists(is_emulator: bool, values: dict[str, str]) -> bool:
    code, _, _ = run_aws_captured(
        aws_base(is_emulator, values) + ["iam", "get-role", "--role-name", SEEDER_ROLE_NAME],
        is_emulator,
    )
    return code == 0


def drop_seeder_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    base = aws_base(is_emulator, values)
    return [
        base + ["iam", "delete-role-policy", "--role-name", SEEDER_ROLE_NAME,
                "--policy-name", SEEDER_POLICY_NAME],
        base + ["iam", "delete-role", "--role-name", SEEDER_ROLE_NAME],
    ]


def drop_seeder_flow(is_emulator: bool, values: dict[str, str], dry_run: bool) -> int:
    """Policy first, then role; a missing role is a no-op. Real AWS repeats the purge barrier."""
    commands = drop_seeder_commands(is_emulator, values)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    if not seeder_role_exists(is_emulator, values):
        print(f"ok: role {SEEDER_ROLE_NAME} does not exist; nothing to drop")
        return 0
    if not is_emulator:
        answer = input(f'type "{SEEDER_ROLE_NAME}" to detach its policy and delete the role: ').strip()
        if answer != SEEDER_ROLE_NAME:
            print("cancelled: the seeder role is untouched")
            return 1
    if run_aws(commands[0], is_emulator) != 0:
        print(f"fix: detach {SEEDER_POLICY_NAME} manually, then rerun (an existing policy is overwritten by reruns)")
        return 1
    print(f"detached: {SEEDER_POLICY_NAME}")
    if run_aws(commands[1], is_emulator) != 0:
        print("fix: delete the role manually once its inline policies are gone")
        return 1
    print(f"deleted: {SEEDER_ROLE_NAME}")
    return 0


def list_bucket_versions(
    is_emulator: bool, values: dict[str, str], session: dict[str, str] | None = None
) -> list[tuple[str, str]] | None:
    """Every (key, version id) in the plane's state bucket, None when listing failed;
    the CLI paginates, so one call spans the bucket."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # a None bucket is a validation error, not a listing input
    code, stdout, stderr = run_aws_captured(
        aws_base(is_emulator, values)
        + ["s3api", "list-object-versions", "--bucket", bucket, "--output", "json"],
        is_emulator,
        session,
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


def confirm_purge(
    is_emulator: bool, values: dict[str, str], session: dict[str, str] | None = None
) -> bool:
    """Typed barrier — terraform does not manage the bucket; a refusal leaves everything intact."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # validation already rejected a missing bucket
    if run_aws(aws_base(is_emulator, values) + ["s3api", "head-bucket", "--bucket", bucket], is_emulator, session) != 0:
        print(f"note: bucket {bucket} does not exist; the purge step will be a no-op")
        return True
    items = list_bucket_versions(is_emulator, values, session) or []
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


def purge_state(is_emulator: bool, values: dict[str, str], session: dict[str, str] | None = None) -> int:
    """Wipe + delete the state bucket, only after terraform destroy succeeded; rerunnable."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # validation already rejected a missing bucket
    base = aws_base(is_emulator, values)
    if run_aws(base + ["s3api", "head-bucket", "--bucket", bucket], is_emulator, session) != 0:
        print(f"note: bucket {bucket} is already gone; nothing to purge")
        return 0
    items = list_bucket_versions(is_emulator, values, session)
    if items is None:
        return 1
    if not items:
        print(f"purge: {bucket} holds no objects")
    for key, version_id in items:
        print(f"purging: {key}")
        delete = base + ["s3api", "delete-object", "--bucket", bucket,
                         "--key", key, "--version-id", version_id]
        if run_aws(delete, is_emulator, session) != 0:
            return 1
    if run_aws(base + ["s3api", "delete-bucket", "--bucket", bucket], is_emulator, session) != 0:
        print("fix: rerun `make secrets-destroy` — safe to repeat when the deletions are still settling")
        return 1
    print(f"deleted: {bucket}")
    return 0


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _expires_at_of(payload: dict[str, Any]) -> datetime:
    raw = str(payload.get("expires_at", ""))
    parsed = datetime.fromisoformat(raw)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def session_remaining_text(payload: dict[str, Any]) -> str:
    try:
        seconds = max(0, int((_expires_at_of(payload) - _utcnow()).total_seconds()))
    except (KeyError, ValueError):
        return "??:??"
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def cached_session(role_arn: str) -> dict[str, Any] | None:
    """The locally cached triplet for this role, only when it outlives the
    renewal margin; anything unusable reads as no cache."""
    try:
        payload = json.loads(SESSION_CACHE_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("role_arn") != role_arn:
        return None
    if not all(payload.get(key) for key in ("access_key_id", "secret_access_key", "session_token")):
        return None
    try:
        remaining = (_expires_at_of(payload) - _utcnow()).total_seconds()
    except (KeyError, ValueError):
        return None
    return payload if remaining > SESSION_RENEWAL_MARGIN_SECONDS else None


def save_cached_session(session: dict[str, Any]) -> None:
    """Atomically land the triplet with owner-only permissions; a write failure
    costs convenience, not the verb run."""
    try:
        SESSION_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", dir=SESSION_CACHE_FILE.parent, prefix=".aws-session-", suffix=".json", delete=False
        ) as handle:
            os.chmod(handle.name, 0o600)
            json.dump(session, handle, indent=2)
            handle.write("\n")
        os.replace(handle.name, SESSION_CACHE_FILE)
    except OSError as exc:
        print(f"note: could not cache the seeder session locally ({exc}); the next verb re-prompts")


def clear_cached_session() -> bool:
    try:
        SESSION_CACHE_FILE.unlink()
        return True
    except FileNotFoundError:
        return False


def assume_seeder_session(role_arn: str, serial: str) -> dict[str, Any]:
    """One MFA prompt, one hour of seeder-role credentials. The assume response
    itself proves the identity, so no follow-up caller check is needed."""
    print(f"carrier: assuming {SEEDER_ROLE_NAME} (MFA, valid for one hour)")
    code = input(f"MFA code for {serial}: ").strip()
    if not MFA_CODE_RE.fullmatch(code):
        die(f"{code!r} is not a 6-digit MFA code", "enter the six-digit code from your MFA device")
    command = [
        "aws", "sts", "assume-role",
        "--role-arn", role_arn,
        "--serial-number", serial,
        "--token-code", code,
        "--duration-seconds", str(SESSION_DURATION_SECONDS),
        "--output", "json",
    ]
    exit_code, stdout, stderr = run_aws_captured(command, False)
    if exit_code != 0:
        detail = (stderr or "").strip().splitlines()[-1] if (stderr or "").strip() else "unknown error"
        die(
            f"could not assume {role_arn}",
            f"check the MFA code and that make secrets-seeder-bootstrap installed the role ({detail})",
        )
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        die(f"could not parse the assume-role output: {exc}", "rerun the verb")
    identity = payload.get("AssumedRoleUser", {}).get("Arn", "") if isinstance(payload, dict) else ""
    if SEEDER_ROLE_SESSION_MARK not in identity:
        die(
            "the assumed identity is not the seeder role",
            f"expected an assumed-role/{SEEDER_ROLE_NAME}/... session, got {identity or 'nothing'}",
        )
    credentials = payload.get("Credentials", {})
    triplet = {
        "access_key_id": credentials.get("AccessKeyId", ""),
        "secret_access_key": credentials.get("SecretAccessKey", ""),
        "session_token": credentials.get("SessionToken", ""),
        "expires_at": credentials.get("Expiration", ""),
    }
    if not all(triplet.values()):
        die("the assume-role response lacks usable credentials", "rerun the verb")
    return {"role_arn": role_arn, **triplet}


def resolve_carrier_session(is_emulator: bool, values: dict[str, str], dry_run: bool) -> dict[str, Any] | None:
    """The real-plane carrier: ambient caller -> derived seeder role -> cached
    triplet, else a fresh assumption. Emulator and dry-run stay session-free."""
    if dry_run or is_emulator:
        return None
    principal = resolve_trust_principal(is_emulator, values)
    role_arn = seeder_role_arn(iam_account_id(principal))
    serial = mfa_serial_for(principal, values.get(SEEDER_MFA_SERIAL_KEY, ""))
    if serial is None:
        die(
            f"cannot derive the caller's MFA device (trust principal: {principal})",
            f"run the verb with your IAM user credentials, or set "
            f"{SEEDER_MFA_SERIAL_KEY}=arn:aws:iam::<account-id>:mfa/<your-user> in .env",
        )
    session = cached_session(role_arn)
    if session is None:
        session = assume_seeder_session(role_arn, serial)
        save_cached_session(session)
    return session


def run_terraform(args: list[str], tf_vars: dict[str, str], env_overlay: dict[str, str] | None = None) -> int:
    terraform = shutil.which("terraform")
    if terraform is None:
        die("terraform not found on PATH", "install terraform >= 1.9 (pinned ~> 1.9 in versions.tf)")
    # Credentials travel in the env overlay (emulator fakes or the seeder session
    # triplet); the provider block stays out of it. The overlay also strips the
    # carrier profile: AWS_PROFILE would outrank env creds in the subprocess env.
    base = os.environ if not env_overlay else {key: value for key, value in os.environ.items() if key != "AWS_PROFILE"}
    env = base | tf_vars | (env_overlay or {})
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
        "command",
        choices=("plan", "apply", "bootstrap", "destroy", "seeder-bootstrap", "seeder-drop", "session-clear"),
        help="terraform plan/apply/destroy, bootstrap (create the plane's state bucket via the aws CLI), "
             "seeder-bootstrap (create/update the out-of-stack seeder role), seeder-drop (detach and "
             "delete it), or session-clear (drop the cached seeder session file)",
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
        "--drop-seeder", action="store_true",
        help="destroy only: after terraform destroy, drop the out-of-stack seeder role "
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
    if args.drop_seeder and args.command != "destroy":
        die("--drop-seeder only applies to the destroy command",
            "run it with destroy (make secrets-destroy)")

    if args.command == "session-clear":
        if clear_cached_session():
            print(f"removed: {SESSION_CACHE_FILE}")
        else:
            print("nothing to clear (no cached seeder session)")
        return 0

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
        session = resolve_carrier_session(is_emulator, values, args.dry_run)
        return bootstrap_state(is_emulator, values, args.dry_run, session)

    if args.command == "seeder-bootstrap":
        errors = validate_seeder_bootstrap(is_emulator, values)
        for error in errors:
            print(error)
        if errors:
            return 1
        return seeder_bootstrap_flow(is_emulator, values, args.dry_run)

    if args.command == "seeder-drop":
        errors = validate_seeder_role(is_emulator, values)
        for error in errors:
            print(error)
        if errors:
            return 1
        return drop_seeder_flow(is_emulator, values, args.dry_run)

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

    session = resolve_carrier_session(is_emulator, values, args.dry_run)
    print(f"plane:   {plane}")
    if is_emulator:
        print("carrier: env creds (test/test, profile stripped)")
    elif args.dry_run:
        print("carrier: seeder role session (promoted when the command runs)")
    else:
        print(f"carrier: role session ({SEEDER_ROLE_NAME}, valid {session_remaining_text(session)})")
    print(f"stack:   {TF_DIR}")
    print(f"secret: {SECRETS_NAME}")
    print(f"key:    *** ({key_len} chars, hidden)")
    print(f"state:  {state_bucket} / {state_key}")
    print(f"window: {resolve_recovery_window(is_emulator, values)} day(s)")
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
            if args.drop_seeder:
                print(f"then drop: {SEEDER_POLICY_NAME} and the {SEEDER_ROLE_NAME} role")
        print("(dry run: no terraform, no AWS)")
        return 0

    # The barrier prompts before any destruction: a refusal keeps the ledger re-appliable.
    if args.command == "destroy" and args.purge_state and not confirm_purge(is_emulator, values, session):
        return 1

    # A dropped emulator bucket heals itself; real AWS fails loudly on its missing explicit bucket.
    if ensure_state_bucket(is_emulator, values) != 0:
        return 1

    backend_file = write_backend_hcl(backend_hcl)
    try:
        init_args = ["init", "-reconfigure", "-backend-config", str(backend_file)]
        # -input=false kills every prompt incl. apply approval; real AWS keeps its confirm.
        verb_args = [args.command]
        if args.command == "plan" or is_emulator:
            verb_args.append("-input=false")
        if args.command in ("apply", "destroy") and is_emulator:
            verb_args.append("-auto-approve")
        # Terraform runs on the carrier's creds: emulator fakes, or the seeder
        # session triplet (env creds outrank any named profile downstream).
        backend_creds = (
            {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
            if is_emulator
            else {
                "AWS_ACCESS_KEY_ID": session["access_key_id"],
                "AWS_SECRET_ACCESS_KEY": session["secret_access_key"],
                "AWS_SESSION_TOKEN": session["session_token"],
            }
        )

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
                run_aws(force_delete_command(is_emulator, values), is_emulator, session)
        # Wipe chain runs only after terraform succeeded: purge, then the seeder role.
        if args.purge_state and purge_state(is_emulator, values, session) != 0:
            return 1
        if args.drop_seeder:
            return drop_seeder_flow(is_emulator, values, args.dry_run)
        return 0
    finally:
        backend_file.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
