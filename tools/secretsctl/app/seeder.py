"""Out-of-stack seeder identity: the IAM carrier role and its STS sessions.

terraform never manages its own carrier: this role is created on demand and
converged (trust, session cap, policy) whenever a verb needs a fresh session;
it trusts whoever runs the tool, and every carrier verb runs under an
MFA-gated 12-hour session cached beside the service's .env.
"""

from __future__ import annotations

import getpass
import json
import os
import re
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote

from app.config import Declaration, state_bucket_for
from app.env import (
    plane_errors,
    resolve_floci_url,
    resolve_region,
)
from app.proc import aws_base, die, run_aws, run_aws_captured

DEFAULT_ACCOUNT_ID = "000000000000"
SEEDER_POLICY_NAME = "seeder-policy"

USER_ARN_RE = re.compile(r"^arn:aws:iam::[0-9]{12}:user/[a-zA-Z0-9+=,.@_-]+$")
MFA_CODE_RE = re.compile(r"^[0-9]{6}$")
SEEDER_MFA_SERIAL_KEY = "SEEDER_MFA_SERIAL"

SESSION_DURATION_SECONDS = 12 * 60 * 60
SESSION_RENEWAL_MARGIN_SECONDS = 10 * 60


def role_session_name(declaration: Declaration) -> str:
    """A stable, sanitized name keeps each laptop's carrier session identifiable in CloudTrail."""
    raw = f"{declaration.slug}-{getpass.getuser()}"
    return re.sub(r"[^A-Za-z0-9=_,.@-]", ".", raw)


def seeder_role_arn(declaration: Declaration, account_id: str) -> str:
    return f"arn:aws:iam::{account_id}:role/{declaration.seeder_role_name}"


def seeder_role_session_mark(declaration: Declaration) -> str:
    return f"assumed-role/{declaration.seeder_role_name}/"


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


def iam_account_id(principal: str) -> str:
    if not principal.startswith("arn:aws:iam::"):
        die(
            f"not an IAM principal ARN: {principal!r}",
            "trust the seeder role to an arn:aws:iam::<account> ARN",
        )
    return principal.split(":")[4]


def plane_account(session: dict[str, Any] | None, is_emulator: bool) -> str:
    """The account owning the plane (its seeder role, stack, and derived state
    bucket): the emulator's constant, the carrier role's account under a live
    session, or — a real dry run carries no session — one read-only identity
    lookup."""
    if is_emulator:
        return DEFAULT_ACCOUNT_ID
    if session:
        return iam_account_id(session["role_arn"])
    return sts_caller_identity()[0]


def resolve_trust_principal(declaration: Declaration, is_emulator: bool) -> str:
    """The IAM principal the seeder role trusts: whoever runs the tool. The
    emulator gets a structural placeholder (it enforces no trust conditions);
    real AWS gets the ambient caller, so the verb runner is the trusted identity."""
    if is_emulator:
        return f"arn:aws:iam::{DEFAULT_ACCOUNT_ID}:user/{declaration.seeder_role_name}"
    _, caller_arn = sts_caller_identity()
    mark = seeder_role_session_mark(declaration)
    if mark in caller_arn:
        die(
            f"the ambient credentials are already a {declaration.seeder_role_name} session ({caller_arn})",
            "unset the exported AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/AWS_SESSION_TOKEN and run "
            "under your personal credentials (the session-clear verb drops the local cache)",
        )
    if caller_arn.endswith(":root"):
        die(
            f"the caller is the account root ({caller_arn}); root sessions cannot satisfy an "
            "MFA-gated assume-role",
            "run the verb under an IAM user's credentials",
        )
    if ":assumed-role/" in caller_arn:
        stripped = role_arn_of_session(caller_arn)
        print(
            f"note: caller is a role session ({caller_arn}); its base role becomes the trust principal: {stripped}"
        )
        return stripped
    return caller_arn


def mfa_serial_for(principal: str, override: str) -> str | None:
    """The caller's MFA device: the override, else derived from a plain user
    ARN. None when the principal is not an MFA-capable IAM user."""
    if override:
        return override
    if USER_ARN_RE.fullmatch(principal):
        account_id = principal.split(":")[4]
        return f"arn:aws:iam::{account_id}:mfa/{principal.split(':user/', 1)[1]}"
    return None


def validate_seeder_role(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[str]:
    """Only what role drop/delete consumes: region and endpoint."""
    return plane_errors(values)


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


def seeder_policy_document(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, user_arn: str
) -> dict[str, Any]:
    """Least privilege on service-pinned ARNs; DescribeParameters alone takes a wildcard."""
    region = resolve_region(declaration, values)
    account = iam_account_id(user_arn)
    # The bucket pin rides the plane account: the emulator places every bucket
    # in one account whatever the trust placeholder says.
    bucket = state_bucket_for(declaration.slug, DEFAULT_ACCOUNT_ID if is_emulator else account)
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "RunTerraformStateBucket",
                "Effect": "Allow",
                "Action": [
                    "s3:CreateBucket",
                    "s3:PutBucketVersioning",
                    "s3:GetBucketVersioning",
                    "s3:ListBucket",
                    "s3:ListBucketVersions",
                    "s3:DeleteBucket",
                ],
                "Resource": [f"arn:aws:s3:::{bucket}"],
            },
            {
                "Sid": "RunTerraformStateObjects",
                "Effect": "Allow",
                "Action": [
                    "s3:GetObject",
                    "s3:GetObjectVersion",
                    "s3:PutObject",
                    "s3:DeleteObject",
                ],
                "Resource": [f"arn:aws:s3:::{bucket}/*"],
            },
            {
                "Sid": "ManageServiceSecret",
                "Effect": "Allow",
                "Action": [
                    "secretsmanager:CreateSecret",
                    "secretsmanager:PutSecretValue",
                    "secretsmanager:UpdateSecret",
                    "secretsmanager:DeleteSecret",
                    "secretsmanager:DescribeSecret",
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:GetResourcePolicy",
                    "secretsmanager:ListSecretVersionIds",
                    "secretsmanager:TagResource",
                ],
                "Resource": [
                    f"arn:aws:secretsmanager:{region}:{account}:secret:{declaration.secret_name}-*"
                ],
            },
            {
                "Sid": "ManageServiceConfig",
                "Effect": "Allow",
                "Action": [
                    "ssm:PutParameter",
                    "ssm:DeleteParameter",
                    "ssm:GetParameter",
                    "ssm:GetParameters",
                    "ssm:GetParametersByPath",
                    "ssm:AddTagsToResource",
                    "ssm:ListTagsForResource",
                ],
                "Resource": [f"arn:aws:ssm:{region}:{account}:parameter{declaration.ssm_prefix}*"],
            },
            {
                # Terraform reads aws_ssm_parameter metadata through DescribeParameters,
                # which IAM offers at account level only — no resource scoping exists for it.
                "Sid": "DescribeSsmParameters",
                "Effect": "Allow",
                "Action": ["ssm:DescribeParameters"],
                "Resource": ["*"],
            },
        ],
    }


def seeder_role_payload(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> dict[str, Any] | None:
    """The role's get-role payload, or None when the role is missing (or unreadable)."""
    code, stdout, _ = run_aws_captured(
        aws_base(declaration, values, is_emulator)
        + [
            "iam",
            "get-role",
            "--role-name",
            declaration.seeder_role_name,
            "--output",
            "json",
        ],
        is_emulator,
    )
    if code != 0:
        return None
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) and payload.get("Role") else None


def _document_of(raw: Any) -> dict[str, Any] | None:
    """An IAM payload's embedded policy document: already-JSON dict or URL-encoded string."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(unquote(raw))
        except json.JSONDecodeError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None


def _ensure_seeder_role(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> None:
    """Create-on-demand with convergence, before every fresh assume: the
    emulator loses IAM on restart, a fresh real account starts empty, and an
    old role's trust, session cap, or policy may lag the code. A converged role
    passes silently; consistent output never blocks the verb."""
    base = aws_base(declaration, values, is_emulator)
    role_name = declaration.seeder_role_name
    principal = resolve_trust_principal(declaration, is_emulator)
    desired_trust = seeder_trust_document(principal)
    desired_policy = seeder_policy_document(declaration, values, is_emulator, principal)

    payload = seeder_role_payload(declaration, values, is_emulator)
    if payload is None:
        print(f"note: seeder role {role_name} is missing; creating it")
        code, _, stderr = run_aws_captured(
            base
            + [
                "iam",
                "create-role",
                "--role-name",
                role_name,
                "--assume-role-policy-document",
                json.dumps(desired_trust),
                "--max-session-duration",
                str(SESSION_DURATION_SECONDS),
            ],
            is_emulator,
        )
        if code != 0 and "EntityAlreadyExists" not in (stderr or ""):
            print("error: create-role failed")
            print((stderr or "").strip())
            die(
                "could not create the seeder role",
                "confirm your credentials may create IAM roles, then rerun the verb",
            )
        print(
            f"created: {role_name} (12h session cap)"
            if code == 0
            else f"ok: role {role_name} already exists"
        )
        if (
            run_aws(
                base
                + [
                    "iam",
                    "put-role-policy",
                    "--role-name",
                    role_name,
                    "--policy-name",
                    SEEDER_POLICY_NAME,
                    "--policy-document",
                    json.dumps(desired_policy),
                ],
                is_emulator,
            )
            != 0
        ):
            die(
                f"could not attach {SEEDER_POLICY_NAME}",
                f"attach {SEEDER_POLICY_NAME} manually, then rerun the verb",
            )
        scopes = ", ".join(statement["Sid"] for statement in desired_policy["Statement"])
        print(f"policy: {SEEDER_POLICY_NAME} attached ({scopes})")
        return

    role = payload["Role"]
    trust = _document_of(role.get("AssumeRolePolicyDocument"))
    if trust is None or trust != desired_trust:
        print(f"note: re-anchoring {role_name}'s trust to the caller ({principal})")
        if (
            run_aws(
                base
                + [
                    "iam",
                    "update-assume-role-policy",
                    "--role-name",
                    role_name,
                    "--policy-document",
                    json.dumps(desired_trust),
                ],
                is_emulator,
            )
            != 0
        ):
            die(
                f"could not re-anchor {role_name}'s trust",
                "confirm your credentials may update the role's trust policy",
            )
    cap = role.get("MaxSessionDuration")
    if not isinstance(cap, int) or cap < SESSION_DURATION_SECONDS:
        print(f"note: raising {role_name}'s session cap to 12h")
        if (
            run_aws(
                base
                + [
                    "iam",
                    "update-role",
                    "--role-name",
                    role_name,
                    "--max-session-duration",
                    str(SESSION_DURATION_SECONDS),
                ],
                is_emulator,
            )
            != 0
        ):
            # A stale cap is non-fatal: a 1h-capped role still assumes, and the
            # assume itself fails loudly with the manual fix when it matters.
            print(f"warning: could not raise {role_name}'s session cap")
    code, stdout, _ = run_aws_captured(
        base
        + [
            "iam",
            "get-role-policy",
            "--role-name",
            role_name,
            "--policy-name",
            SEEDER_POLICY_NAME,
            "--output",
            "json",
        ],
        is_emulator,
    )
    attached = None
    if code == 0:
        try:
            attached = _document_of(json.loads(stdout).get("PolicyDocument"))
        except (json.JSONDecodeError, AttributeError):
            attached = None
    if attached != desired_policy:
        print(f"note: re-attaching {SEEDER_POLICY_NAME} (drifted from the code's pin)")
        if (
            run_aws(
                base
                + [
                    "iam",
                    "put-role-policy",
                    "--role-name",
                    role_name,
                    "--policy-name",
                    SEEDER_POLICY_NAME,
                    "--policy-document",
                    json.dumps(desired_policy),
                ],
                is_emulator,
            )
            != 0
        ):
            die(
                f"could not re-attach {SEEDER_POLICY_NAME}",
                f"attach {SEEDER_POLICY_NAME} manually, then rerun the verb",
            )


def drop_seeder_commands(
    declaration: Declaration, values: dict[str, str], is_emulator: bool
) -> list[list[str]]:
    base = aws_base(declaration, values, is_emulator)
    return [
        base
        + [
            "iam",
            "delete-role-policy",
            "--role-name",
            declaration.seeder_role_name,
            "--policy-name",
            SEEDER_POLICY_NAME,
        ],
        base + ["iam", "delete-role", "--role-name", declaration.seeder_role_name],
    ]


def drop_seeder_flow(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, dry_run: bool
) -> int:
    """Policy first, then role; a missing role is a no-op. Real AWS repeats the purge barrier."""
    commands = drop_seeder_commands(declaration, values, is_emulator)
    if dry_run:
        for command in commands:
            print(f"would run: {' '.join(command)}")
        print("(dry run: no AWS)")
        return 0
    if seeder_role_payload(declaration, values, is_emulator) is None:
        print(f"ok: role {declaration.seeder_role_name} does not exist; nothing to drop")
        return 0
    if not is_emulator:
        answer = input(
            f'type "{declaration.seeder_role_name}" to detach its policy and delete the role: '
        ).strip()
        if answer != declaration.seeder_role_name:
            print("cancelled: the seeder role is untouched")
            return 1
    if run_aws(commands[0], is_emulator) != 0:
        print(
            f"fix: detach {SEEDER_POLICY_NAME} manually, then rerun (an existing policy is overwritten by reruns)"
        )
        return 1
    print(f"detached: {SEEDER_POLICY_NAME}")
    if run_aws(commands[1], is_emulator) != 0:
        print("fix: delete the role manually once its inline policies are gone")
        return 1
    print(f"deleted: {declaration.seeder_role_name}")
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


def cached_session(role_arn: str, session_cache: Path) -> dict[str, Any] | None:
    """The locally cached triplet for this role, only when it outlives the
    renewal margin; anything unusable reads as no cache."""
    try:
        payload = json.loads(session_cache.read_text())
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


def save_cached_session(session: dict[str, Any], session_cache: Path) -> None:
    """Atomically land the triplet with owner-only permissions; a write failure
    costs convenience, not the verb run."""
    try:
        session_cache.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", dir=session_cache.parent, prefix=".aws-session-", suffix=".json", delete=False
        ) as handle:
            os.chmod(handle.name, 0o600)
            json.dump(session, handle, indent=2)
            handle.write("\n")
        os.replace(handle.name, session_cache)
    except OSError as exc:
        print(f"note: could not cache the seeder session locally ({exc}); the next verb re-prompts")


def clear_cached_session(session_cache: Path) -> bool:
    try:
        session_cache.unlink()
        return True
    except FileNotFoundError:
        return False


def assume_seeder_session(
    role_arn: str,
    serial: str | None,
    declaration: Declaration,
    is_emulator: bool = False,
) -> dict[str, Any]:
    """One assume-role exchange producing a 12-hour seeder session. The assume
    response itself proves the identity, so no follow-up caller check is needed.
    The real plane gates the call behind an MFA prompt; the emulator enforces no
    trust conditions, so it assumes without one."""
    command = ["aws"]
    if is_emulator:
        command += ["--endpoint-url", resolve_floci_url()]
    command += [
        "sts",
        "assume-role",
        "--role-arn",
        role_arn,
        "--role-session-name",
        role_session_name(declaration),
        "--duration-seconds",
        str(SESSION_DURATION_SECONDS),
        "--output",
        "json",
    ]
    if serial is None:
        print(f"carrier: assuming {declaration.seeder_role_name}")
    else:
        print(f"carrier: assuming {declaration.seeder_role_name} (MFA, valid for 12 hours)")
        code = input(f"MFA code for {serial}: ").strip()
        if not MFA_CODE_RE.fullmatch(code):
            die(
                f"{code!r} is not a 6-digit MFA code",
                "enter the six-digit code from your MFA device",
            )
        command += ["--serial-number", serial, "--token-code", code]
    exit_code, stdout, stderr = run_aws_captured(command, is_emulator)
    if exit_code != 0:
        stderr_text = (stderr or "").strip()
        detail = stderr_text.splitlines()[-1] if stderr_text else "unknown error"
        hint = f"check the MFA code and that the seeder role trusts your caller ({detail})"
        if "MaxSessionDuration" in stderr_text or "DurationSeconds" in stderr_text:
            hint = (
                f"the role's session cap is below {SESSION_DURATION_SECONDS}s, fix it with "
                f"aws iam update-role --role-name {declaration.seeder_role_name} "
                f"--max-session-duration {SESSION_DURATION_SECONDS} ({detail})"
            )
        die(f"could not assume {role_arn}", hint)
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        die(f"could not parse the assume-role output: {exc}", "rerun the verb")
    identity = (
        payload.get("AssumedRoleUser", {}).get("Arn", "") if isinstance(payload, dict) else ""
    )
    mark = seeder_role_session_mark(declaration)
    if mark not in identity:
        die(
            "the assumed identity is not the seeder role",
            f"expected an assumed-role/{declaration.seeder_role_name}/... session, got {identity or 'nothing'}",
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


def resolve_carrier_session(
    declaration: Declaration,
    values: dict[str, str],
    is_emulator: bool,
    dry_run: bool,
    session_cache: Path,
) -> dict[str, Any] | None:
    """The carrier on both planes: cached triplet when valid, otherwise converge
    the service's out-of-stack seeder role (create or repair its trust, session
    cap, and policy) and take a fresh assume of it. Dry runs stay session-free."""
    if dry_run:
        return None
    principal = resolve_trust_principal(declaration, is_emulator)
    serial = None
    if not is_emulator:
        serial = mfa_serial_for(principal, values.get(SEEDER_MFA_SERIAL_KEY, ""))
        if serial is None:
            die(
                f"cannot derive the caller's MFA device (trust principal: {principal})",
                "run the verb under your IAM user credentials, or set "
                f"{SEEDER_MFA_SERIAL_KEY}=arn:aws:iam::<account-id>:mfa/<your-user> in .env",
            )
    role_arn = seeder_role_arn(declaration, iam_account_id(principal))
    session = cached_session(role_arn, session_cache)
    if session is None:
        _ensure_seeder_role(declaration, values, is_emulator)
        session = assume_seeder_session(role_arn, serial, declaration, is_emulator)
        save_cached_session(session, session_cache)
    return session
