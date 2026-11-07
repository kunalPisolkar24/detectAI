"""The observability seeder policy: S3 on the tfstate bucket family, nothing else."""

from __future__ import annotations

from typing import Any

from app.engine.declaration.model import Declaration
from app.kinds.observability.values import DEFAULT_STATE_BUCKET, resolve_state_bucket


def seeder_policy_document(
    declaration: Declaration, values: dict[str, str], is_emulator: bool, user_arn: str
) -> dict[str, Any]:
    """Least privilege beyond the trust ladder: the role exists to carry the
    stack's S3 state traffic (bucket heal, terraform init, lockfile state), so
    its inline policy scopes the tfstate bucket this run resolves on its plane
    and no other service class."""
    bucket = resolve_state_bucket(values, is_emulator) or DEFAULT_STATE_BUCKET
    family = f"arn:aws:s3:::{bucket}*"
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "RunTerraformStateBucket",
                "Effect": "Allow",
                "Action": [
                    "s3:CreateBucket",
                    "s3:ListBucket",
                    "s3:GetBucketVersioning",
                    "s3:PutBucketVersioning",
                    "s3:ListBucketVersions",
                ],
                "Resource": [family],
            },
            {
                "Sid": "RunTerraformStateObjects",
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
                "Resource": [f"{family}/*"],
            },
        ],
    }
