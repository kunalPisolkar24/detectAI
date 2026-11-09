"""The observability seeder policy: S3 on the state bucket, nothing else."""

from __future__ import annotations

from typing import Any

from app.engine.carrier.identity import DEFAULT_ACCOUNT_ID, iam_account_id
from app.engine.declaration.model import Declaration, state_bucket_for


def seeder_policy_document(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, user_arn: str
) -> dict[str, Any]:
    """Least privilege beyond the trust ladder: the role exists to carry the
    stack's S3 state traffic (bucket heal, terraform init, lockfile state), so
    its inline policy scopes the tfstate bucket and no other resource class."""
    # The bucket pin rides the plane account: the emulator places every bucket
    # in one account whatever the trust placeholder says.
    account = DEFAULT_ACCOUNT_ID if is_emulator else iam_account_id(user_arn)
    bucket = state_bucket_for(declaration.slug, account)
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
        ],
    }
