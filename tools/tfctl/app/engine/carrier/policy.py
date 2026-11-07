"""IAM trust for the seeder role, and the trust principal: kind-independent."""

from __future__ import annotations

from typing import Any

from app.engine.carrier.identity import (
    DEFAULT_ACCOUNT_ID,
    role_arn_of_session,
    seeder_role_session_mark,
    sts_caller_identity,
)
from app.engine.declaration.model import Declaration
from app.engine.shell import die


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
