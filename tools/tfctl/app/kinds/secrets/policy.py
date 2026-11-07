"""The secrets plane's seeder policy: least privilege on service-pinned ARNs."""

from __future__ import annotations

from typing import Any

from app.engine.carrier.identity import DEFAULT_ACCOUNT_ID, iam_account_id
from app.engine.declaration.model import state_bucket_for
from app.engine.values.plane import resolve_region
from app.kinds.secrets.declaration import SecretsDeclaration


def seeder_policy_document(
    declaration: SecretsDeclaration, values: dict[str, str], is_emulator: bool, user_arn: str
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
