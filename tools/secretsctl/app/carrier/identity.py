"""Out-of-stack identity plumbing: ambient STS resolution and derived ARN helpers."""

from __future__ import annotations

import json
import re
from typing import Any

from app.declaration.model import Declaration
from app.shell import die, run_aws_captured

DEFAULT_ACCOUNT_ID = "000000000000"
SESSION_DURATION_SECONDS = 12 * 60 * 60

USER_ARN_RE = re.compile(r"^arn:aws:iam::[0-9]{12}:user/[a-zA-Z0-9+=,.@_-]+$")


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
