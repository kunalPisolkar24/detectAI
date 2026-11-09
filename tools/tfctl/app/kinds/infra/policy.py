"""The infra seeder policy: the state plane plus the declared queue fabric."""

from __future__ import annotations

from typing import Any

from app.engine.carrier.identity import DEFAULT_ACCOUNT_ID, iam_account_id
from app.engine.values.plane import resolve_region
from app.kinds.infra.declaration import InfraDeclaration
from app.kinds.infra.values import DEFAULT_STATE_BUCKET, resolve_state_bucket

# The management surface aws_sqs_queue exercises: create/read/update/redrive/
# tags. ListQueues stays out — the provider never calls it for these resources.
QUEUE_ACTIONS = (
    "sqs:CreateQueue",
    "sqs:DeleteQueue",
    "sqs:GetQueueUrl",
    "sqs:GetQueueAttributes",
    "sqs:SetQueueAttributes",
    "sqs:TagQueue",
    "sqs:UntagQueue",
    "sqs:ListQueueTags",
)


def seeder_policy_document(
    declaration: InfraDeclaration, values: dict[str, str], is_emulator: bool, user_arn: str
) -> dict[str, Any]:
    """Least privilege on the ledger: the s3 state plane plus exactly the
    declared queues' management surface — no other resource class anywhere."""
    region = resolve_region(declaration, values)
    # The queue/bucket ARNs ride the plane account: the emulator places every
    # resource in one account whatever the trust placeholder says.
    account = DEFAULT_ACCOUNT_ID if is_emulator else iam_account_id(user_arn)
    bucket = resolve_state_bucket(values, is_emulator) or DEFAULT_STATE_BUCKET
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "RunTerraformStateBucket",
                "Effect": "Allow",
                "Action": [
                    "s3:CreateBucket",
                    "s3:DeleteBucket",
                    "s3:ListBucket",
                    "s3:ListBucketVersions",
                    "s3:GetBucketVersioning",
                    "s3:PutBucketVersioning",
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
                "Sid": "ManageQueueFabric",
                "Effect": "Allow",
                "Action": list(QUEUE_ACTIONS),
                "Resource": [
                    f"arn:aws:sqs:{region}:{account}:{entry.name}"
                    for entry in declaration.queue_ledger
                ],
            },
        ],
    }
