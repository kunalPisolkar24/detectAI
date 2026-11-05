"""IAM trust and policy documents for the seeder role, and the trust principal."""

from __future__ import annotations

from typing import Any

from app.carrier.identity import (
    DEFAULT_ACCOUNT_ID,
    iam_account_id,
    role_arn_of_session,
    seeder_role_session_mark,
    sts_caller_identity,
)
from app.declaration.model import Declaration, state_bucket_for
from app.shell import die
from app.values.plane import resolve_region


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
                    "s3:DeleteObjectVersion",
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
