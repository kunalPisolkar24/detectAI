#!/usr/bin/env python3
"""The credentials brain for the observability Terraform root.

Parses envs/.env (gitignored, created by `make env`), validates the New
Relic credential triple and drives terraform for the dashboards/alerts
stack. Only check/plan/apply/plan-local/apply-local/bootstrap live here:
offline tasks (fmt/validate/test) run through mk/local.mk without
credentials and never touch this script.

Validation rules, loud by design:
  - NEW_RELIC_API_KEY must be a User API key (NRAK-...). The ingest license
    key (eu01...) that apps use for OTLP does not work for the management
    API, so a license-shaped value is rejected with that explanation.
  - NEW_RELIC_ACCOUNT_ID is numeric; NEW_RELIC_REGION is US, EU or JP.
  - check --live resolves the account name over GraphQL to catch a
    valid-looking key pointed at the wrong account before any plan runs.

Credentials and state keys resolve opposite ways, on purpose:
  - NEW_RELIC_* values: the real shell env wins per key (single-run
    overrides stay convenient).
  - TF_STATE_BUCKET / EMULATOR_ENDPOINT / AWS_REGION: envs/.env wins; a
    conflicting shell export warns and is ignored — the state plane must
    be reproducible, not per-invocation.

State plane (the same single-flick contract as document-parser) is decided by
EMULATOR_ENDPOINT in .env:
  http(s) URL    -> Floci emulator; TF_STATE_BUCKET may stay unset (defaults
                    to detectai-observability-tfstate), a health probe (2s)
                    runs before any aws call and a missing bucket self-heals;
                    apply auto-approves.
  unset or empty -> real AWS; TF_STATE_BUCKET required, no guessing. A
                    missing bucket is created + versioned (S3-native state
                    locking needs it); apply keeps the interactive confirm.

There is no bare ./terraform.tfstate mode: every plan/apply goes through an
initialized backend, which is what keeps the plane explicit. (mk/local.mk's
`init -backend=false` stays offline-only, for validate/test.)

The script's only direct AWS-API steps run through the `aws` CLI: creating
(and versioning) the state bucket, implicitly before every S3-plane
terraform call and explicitly via the `bootstrap` verb. Terraform alone
touches New Relic.
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
import urllib.request
from pathlib import Path

TF_DIR = Path(__file__).resolve().parents[1]
ENV_FILE = TF_DIR / "envs" / ".env"

REGION_DEFAULT = "ap-south-1"
DEFAULT_STATE_BUCKET = "detectai-observability-tfstate"
FLOCI_STATE_KEY = "observability/floci/terraform.tfstate"
PROD_STATE_KEY = "observability/terraform.tfstate"

REGION_RE = re.compile(r"^[a-z]{2}-[a-z]+-[0-9]+$")
URL_RE = re.compile(r"^https?://\S+$")
# S3 naming minus dots: exactly 3-63 lowercase/digits/hyphens, alnum boundaries.
BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$")

API_KEY_RE = "NRAK-"
REGIONS = ("US", "EU", "JP")
API_KEY_MIN_LENGTH = 20

GRAPHQL_HOSTS = {
    "EU": "https://api.eu.newrelic.com/graphql",
    "US": "https://api.newrelic.com/graphql",
    "JP": "https://api.jp.newrelic.com/graphql",
}


def die(message: str, fix: str) -> None:
    print(f"error: {message}")
    print(f"fix:   {fix}")
    sys.exit(1)


def parse_env_file(path: Path) -> dict[str, str]:
    """KEY=value parser: strips inline comments, keeps the first duplicate."""
    if not path.exists():
        die(f"{path} is missing",
            "run `make env` in observability/terraform first, then fill NEW_RELIC_API_KEY")
    values: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep:
            die(f"{path.name}:{lineno}: expected KEY=VALUE, got: {line!r}",
                "comment lines with #")
        key = key.strip()
        value = re.sub(r"\s+#.*$", "", value).strip().strip("'\"")
        if not key:
            print(f"warning: {path.name}:{lineno}: empty key before '='; skipped")
            continue
        if key in values:
            print(f"warning: {path.name}:{lineno}: duplicate {key}; keeping the first")
            continue
        values[key] = value
    return values


# ── New Relic credentials ────────────────────────────────────────────────────


def resolve_credential(env_key: str, file_values: dict[str, str]) -> str | None:
    """Shell env wins per key; envs/.env fills the rest."""
    return os.environ.get(env_key) or file_values.get(env_key) or None


def build_config(file_values: dict[str, str]) -> dict[str, str | None]:
    return {
        "api_key": resolve_credential("NEW_RELIC_API_KEY", file_values),
        "account_id": resolve_credential("NEW_RELIC_ACCOUNT_ID", file_values),
        "region": resolve_credential("NEW_RELIC_REGION", file_values),
    }


def validate_config(config: dict[str, str | None]) -> list[str]:
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    api_key = config["api_key"]
    if not api_key:
        fail("NEW_RELIC_API_KEY is empty in envs/.env",
             "export NEW_RELIC_API_KEY=NRAK-... for one run, or fill it in envs/.env "
             "(User API key from New Relic UI -> API keys & Credentials)")
    elif not api_key.startswith(API_KEY_RE):
        fail(
            "NEW_RELIC_API_KEY is not a User API key: it must start with "
            f"'{API_KEY_RE}-...'. The ingest license key (eu01...) apps use for OTLP "
            "is the wrong credential class for Terraform.",
            "create a User key in New Relic UI -> API keys & Credentials",
        )
    elif len(api_key) < API_KEY_MIN_LENGTH:
        fail("NEW_RELIC_API_KEY looks truncated (shorter than 20 chars)",
             "paste the full key from New Relic UI -> API keys & Credentials")

    if (account_id := config["account_id"]) is not None and not account_id.isdigit():
        fail(f"NEW_RELIC_ACCOUNT_ID must be numeric, got {account_id!r}",
             "use the 7-digit account id from the New Relic footer or API keys page")

    if (region := config["region"]) is not None and region.upper() not in REGIONS:
        fail(f"NEW_RELIC_REGION must be one of {', '.join(REGIONS)}, got {region!r}",
             "set US, EU or JP (matches api.<xr>.newrelic.com)")
    return errors


def masked(api_key: str) -> str:
    return f"{api_key[:4]}...{api_key[-4:]}"


def describe(config: dict[str, str | None]) -> None:
    region = config["region"] or "EU"
    source = "shell" if os.environ.get("NEW_RELIC_API_KEY") else "envs/.env"
    print(f"{ENV_FILE}:")
    print(f"  NEW_RELIC_API_KEY     {masked(config['api_key'])} (from {source})")
    print(f"  NEW_RELIC_ACCOUNT_ID  {config['account_id'] or '(default 6428768)'}")
    print(f"  NEW_RELIC_REGION      {region}")


def live_check(config: dict[str, str | None]) -> None:
    """One GraphQL round-trip proving the key and the account fit together."""
    region = (config["region"] or "EU").upper()
    account_id = int(config["account_id"] or 6428768)
    payload = json.dumps({
        "query": "query($id: Int!) { actor { account(id: $id) { name } } }",
        "variables": {"id": account_id},
    }).encode()
    request = urllib.request.Request(
        GRAPHQL_HOSTS[region],
        data=payload,
        headers={"API-Key": config["api_key"], "Content-Type": "application/json"},
    )
    bad_key = "check NEW_RELIC_API_KEY (User API key, NRAK-...)"
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.load(response)
    except urllib.error.HTTPError as err:
        fix = bad_key if err.code in (401, 403) else "retry, or check status.newrelic.com"
        die(f"New Relic API answered {err.code} ({err.reason})", fix)
    except urllib.error.URLError as err:
        die(f"cannot reach {GRAPHQL_HOSTS[region]}: {err.reason}",
            "check the network, then retry make check LIVE=1")

    account = (body.get("data") or {}).get("actor", {}).get("account")
    if account is None:
        die(f"the key is valid but account {account_id} is not visible to it",
            "check NEW_RELIC_ACCOUNT_ID, or the key's user lacks this account")
    print(f"  live: region {region}, account {account['name']} ({account_id}) OK")


# ── State plane (document-parser contract) ──────────────────────────────────


def resolve_region(values: dict[str, str]) -> str:
    return values.get("AWS_REGION") or REGION_DEFAULT


def resolve_plane(values: dict[str, str]) -> tuple[str, bool]:
    is_emulator = bool(values.get("EMULATOR_ENDPOINT"))
    plane = "emulator (Floci)" if is_emulator else "real AWS"
    return plane, is_emulator


def resolve_state_bucket(is_emulator: bool, values: dict[str, str]) -> str | None:
    """State bucket for the plane: .env value if set; Floci falls back to the
    fixed local default; real AWS stays required (no guessing)."""
    bucket = values.get("TF_STATE_BUCKET", "")
    if bucket:
        return bucket
    return DEFAULT_STATE_BUCKET if is_emulator else None


def warn_shell_conflicts(values: dict[str, str]) -> None:
    env_bucket = values.get("TF_STATE_BUCKET", "")
    shell_bucket = os.environ.get("TF_STATE_BUCKET")
    if env_bucket and shell_bucket and shell_bucket != env_bucket:
        print(f"note: TF_STATE_BUCKET also exported in the shell ({shell_bucket!r}); the .env value wins")


def validate_state(is_emulator: bool, values: dict[str, str]) -> list[str]:
    """Shape checks only: what the resolved plane, region and URL consume.
    A missing TF_STATE_BUCKET is not an error here — it defaults on the
    Floci plane and is demanded once a real-AWS terraform verb runs."""
    errors: list[str] = []

    def fail(message: str, fix: str) -> None:
        errors.append(f"error: {message}\nfix:   {fix}")

    if (region := values.get("AWS_REGION")) is not None and not REGION_RE.fullmatch(region):
        fail(
            f"AWS_REGION is not a valid state-bucket region: {region!r}",
            "use a plain region code, e.g. ap-south-1 (this is not NEW_RELIC_REGION)",
        )
    if is_emulator:
        endpoint = values["EMULATOR_ENDPOINT"]
        if not URL_RE.fullmatch(endpoint):
            fail(
                f"EMULATOR_ENDPOINT is not a valid http(s) URL: {endpoint!r}",
                "set it to the Floci URL (http://localhost:4566) or remove the line for real AWS",
            )
    if (bucket := values.get("TF_STATE_BUCKET", "")) and not BUCKET_RE.fullmatch(bucket):
        fail(
            f"TF_STATE_BUCKET is not a valid S3 bucket name: {bucket!r}",
            "use 3-63 lowercase letters, digits or hyphens, starting and ending alphanumeric",
        )
    return errors


BUCKET_MISSING_ERROR = "the real-AWS plane needs a state bucket: TF_STATE_BUCKET is not set in envs/.env"
BUCKET_MISSING_FIX = (
    "add TF_STATE_BUCKET=<unique 3-63 char lowercase bucket> to envs/.env "
    "(make bootstrap creates it), or set EMULATOR_ENDPOINT=http://localhost:4566 for the Floci plane"
)


def describe_plane(values: dict[str, str]) -> None:
    plane, is_emulator = resolve_plane(values)
    bucket = resolve_state_bucket(is_emulator, values)
    state_key = FLOCI_STATE_KEY if is_emulator else PROD_STATE_KEY
    print(f"plane:  {plane}")
    if bucket:
        print(f"state:  {bucket} / {state_key}")
        if is_emulator and not values.get("TF_STATE_BUCKET"):
            print(f"note:   TF_STATE_BUCKET unset; the Floci plane defaults to {DEFAULT_STATE_BUCKET}")
    else:
        print("state:  unset -> TF_STATE_BUCKET is required before plan/apply/bootstrap run")
        print(f"note:   add TF_STATE_BUCKET to envs/.env, or set EMULATOR_ENDPOINT for the Floci plane (default {DEFAULT_STATE_BUCKET})")


# ── aws CLI: the bucket steps ────────────────────────────────────────────────


def probe_emulator(endpoint: str) -> None:
    """2s health gate: a dead emulator fails loudly here with a start hint
    instead of inside terraform's init (the failure that wastes a run)."""
    try:
        with urllib.request.urlopen(f"{endpoint}/_localstack/health", timeout=2) as response:
            json.load(response)
    except Exception:
        die(f"the emulator at {endpoint} did not answer /_localstack/health within 2s",
            "start it (`make floci-up` in the repo root) and rerun")


def aws_base(is_emulator: bool, values: dict[str, str]) -> list[str]:
    base = ["aws", "--region", resolve_region(values)]
    if is_emulator:
        base += ["--endpoint-url", values["EMULATOR_ENDPOINT"]]
    return base


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


def bootstrap_commands(is_emulator: bool, values: dict[str, str]) -> list[list[str]]:
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # a None bucket is a validation error, not a bootstrap input
    command_base = aws_base(is_emulator, values)
    return [
        command_base + ["s3api", "head-bucket", "--bucket", bucket],
        command_base + ["s3", "mb", f"s3://{bucket}"],
        *(
            []
            if is_emulator
            else [command_base + ["s3api", "put-bucket-versioning", "--bucket", bucket,
                                  "--versioning-configuration", "Status=Enabled"]]
        ),
    ]


def bootstrap_state(is_emulator: bool, values: dict[str, str]) -> int:
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # already demanded by the caller
    commands = bootstrap_commands(is_emulator, values)
    head_result = run_aws(commands[0], is_emulator)
    if head_result == 0:
        print(f"ok:  bucket {bucket} already exists")
    else:
        if run_aws(commands[1], is_emulator) != 0:
            if is_emulator:
                print()
                print(f"fix: check that the emulator is reachable at {values['EMULATOR_ENDPOINT']} (e.g. make floci-up)")
            return 1
        print(f"created: {bucket}")
    if not is_emulator:
        if run_aws(commands[-1], is_emulator) != 0:
            print("fix: enable bucket versioning manually (required for terraform state locking)")
            return 1
        print("versioning: Enabled")
    return 0


def ensure_state_bucket(is_emulator: bool, values: dict[str, str]) -> int:
    """Self-heal on both planes: a .env-selected bucket missing at run time is
    created before terraform starts (the same law the emulator plane always
    had — the emulator's in-memory S3 loses buckets on restart). Real AWS
    additionally gets versioning for S3-native state locking."""
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # the caller demands a resolvable bucket
    head = run_aws_captured(aws_base(is_emulator, values) + ["s3api", "head-bucket", "--bucket", bucket], is_emulator)
    if head[0] == 0:
        return 0
    print(f"note: state bucket {bucket} is missing; creating it")
    return bootstrap_state(is_emulator, values)


# ── terraform ────────────────────────────────────────────────────────────────


def terraform_environment(config: dict[str, str | None], is_emulator: bool) -> dict[str, str]:
    env = dict(os.environ)
    env["TF_VAR_newrelic_api_key"] = config["api_key"]
    if config["account_id"]:
        env["TF_VAR_newrelic_account_id"] = config["account_id"]
    if config["region"]:
        env["TF_VAR_newrelic_region"] = config["region"]
    # Backend credentials come from the environment, not the provider block:
    # the emulator's test creds must travel with it or backend init fails.
    if is_emulator:
        env |= {"AWS_ACCESS_KEY_ID": "test", "AWS_SECRET_ACCESS_KEY": "test"}
    return env


def run_terraform(args: list[str], config: dict[str, str | None], is_emulator: bool) -> int:
    terraform = shutil.which("terraform")
    if terraform is None:
        die("terraform not found on PATH", "install terraform >= 1.9 (pinned ~> 1.9 in versions.tf)")
    print()
    try:
        return subprocess.run(
            [terraform, *args],
            cwd=TF_DIR,
            check=False,
            env=terraform_environment(config, is_emulator),
        ).returncode
    except OSError as exc:
        die(f"failed to run terraform: {exc}", "check the terraform installation")


def build_backend_hcl(is_emulator: bool, values: dict[str, str]) -> str:
    region = resolve_region(values)
    bucket = resolve_state_bucket(is_emulator, values)
    assert bucket is not None  # a None bucket is a validation error, not a backend input
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


def init_failure_hints(is_emulator: bool, values: dict[str, str]) -> None:
    bucket = resolve_state_bucket(is_emulator, values)
    print()
    if is_emulator:
        assert bucket is not None
        print("fix: create the emulator state bucket and retry (make bootstrap)")
        print(
            f"fix: aws --endpoint-url {values['EMULATOR_ENDPOINT']} "
            f"s3 mb s3://{bucket} --region {resolve_region(values)}"
        )
    else:
        print(
            f"fix: confirm bucket {bucket} exists and your credentials allow access "
            f"(region {resolve_region(values)}); make bootstrap can create it"
        )


def run_s3_flow(command: str, config: dict[str, str | None], values: dict[str, str]) -> int:
    """plan/apply against the .env-selected S3 plane, a self-healed bucket."""
    plane, is_emulator = resolve_plane(values)
    bucket = resolve_state_bucket(is_emulator, values)
    state_key = FLOCI_STATE_KEY if is_emulator else PROD_STATE_KEY
    print(f"plane:  {plane}")
    print(f"stack:  {TF_DIR}")
    print(f"key:    *** ({len(config['api_key'] or '')} chars, hidden)")
    print(f"state:  {bucket} / {state_key}")
    if is_emulator and not values.get("TF_STATE_BUCKET"):
        print(f"note:   TF_STATE_BUCKET unset; the Floci plane defaults to {DEFAULT_STATE_BUCKET}")

    if is_emulator:
        probe_emulator(values["EMULATOR_ENDPOINT"])
    if ensure_state_bucket(is_emulator, values) != 0:
        return 1

    backend_file = write_backend_hcl(build_backend_hcl(is_emulator, values))
    try:
        init_args = ["init", "-reconfigure", "-input=false", "-backend-config", str(backend_file)]
        if run_terraform(init_args, config, is_emulator) != 0:
            init_failure_hints(is_emulator, values)
            return 1
        # -input=false disables ALL prompts, including the apply approval; real
        # AWS must keep its confirm prompt, so it applies without the flag.
        verb_args = [command, "-var-file=envs/prod.tfvars"]
        if command == "plan" or is_emulator:
            verb_args.append("-input=false")
        if command == "apply" and is_emulator:
            verb_args.append("-auto-approve")
        return run_terraform(verb_args, config, is_emulator)
    finally:
        backend_file.unlink(missing_ok=True)


# ── verbs ────────────────────────────────────────────────────────────────────


def main() -> int:
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(line_buffering=True)
    parser = argparse.ArgumentParser(
        description="Validate the New Relic credentials in envs/.env and drive the observability Terraform root."
    )
    verbs = parser.add_subparsers(dest="command", required=True)
    check = verbs.add_parser(
        "check",
        help="validate envs/.env and preview the resolved plane; --live also resolves the account name",
    )
    check.add_argument("--live", action="store_true",
                       help="one GraphQL call to api.<region>.newrelic.com (writes nothing)")
    verbs.add_parser("plan", help="terraform plan against the plane envs/.env selects (Floci or real AWS)")
    verbs.add_parser("apply", help="terraform apply (auto on Floci, interactive confirm on real AWS)")
    verbs.add_parser("bootstrap", help="create the .env plane's state bucket via the aws CLI (idempotent, no key needed)")
    args = parser.parse_args()
    command: str = args.command

    file_values = parse_env_file(ENV_FILE)

    if command == "bootstrap":
        # The bucket verb consumes only the state keys: no New Relic key needed.
        plane, is_emulator = resolve_plane(file_values)
        errors = validate_state(is_emulator, file_values)
        for error in errors:
            print(error)
        if errors:
            return 1
        if resolve_state_bucket(is_emulator, file_values) is None:
            die(BUCKET_MISSING_ERROR, BUCKET_MISSING_FIX)
        print(f"plane:  {plane}")
        if is_emulator:
            probe_emulator(file_values["EMULATOR_ENDPOINT"])
        return bootstrap_state(is_emulator, file_values)

    config = build_config(file_values)
    plane, is_emulator = resolve_plane(file_values)
    state_errors = validate_state(is_emulator, file_values)

    if command == "check":
        errors = validate_config(config) + state_errors
        for error in errors:
            print(error)
        if errors:
            return 1
        describe(config)
        describe_plane(file_values)
        if args.live:
            live_check(config)
        return 0

    errors = validate_config(config) + state_errors
    if command in ("plan", "apply") and resolve_state_bucket(is_emulator, file_values) is None:
        errors.append(f"error: {BUCKET_MISSING_ERROR}\nfix:   {BUCKET_MISSING_FIX}")
    for error in errors:
        print(error)
    if errors:
        return 1

    warn_shell_conflicts(file_values)
    return run_s3_flow(command, config, file_values)


if __name__ == "__main__":
    raise SystemExit(main())
