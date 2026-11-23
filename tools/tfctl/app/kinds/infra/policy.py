"""The infra seeder policy: the state plane plus exactly the declared fabrics."""

from __future__ import annotations

from typing import Any

from app.engine.carrier.identity import DEFAULT_ACCOUNT_ID, iam_account_id
from app.engine.declaration.model import state_bucket_for
from app.engine.values.plane import resolve_region
from app.kinds.infra.declaration import InfraDeclaration

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

# The management surface the cache module exercises: serverless caches and
# tags. No data-plane or ec2 describe calls — placement comes from the values
# file.
CACHE_ACTIONS = (
    "elasticache:CreateServerlessCache",
    "elasticache:DeleteServerlessCache",
    "elasticache:DescribeServerlessCaches",
    "elasticache:ModifyServerlessCache",
    "elasticache:ListTagsForResource",
    "elasticache:AddTagsToResource",
    "elasticache:RemoveTagsFromResource",
)

# The Aurora Serverless v2 management surface: clusters, instances and subnet
# groups. No RDS Proxy actions — that fabric is deliberately not modeled.
RDS_ACTIONS = (
    "rds:CreateDBCluster",
    "rds:DeleteDBCluster",
    "rds:DescribeDBClusters",
    "rds:ModifyDBCluster",
    "rds:CreateDBInstance",
    "rds:DeleteDBInstance",
    "rds:DescribeDBInstances",
    "rds:ModifyDBInstance",
    "rds:CreateDBSubnetGroup",
    "rds:DeleteDBSubnetGroup",
    "rds:DescribeDBSubnetGroups",
    "rds:ListTagsForResource",
    "rds:AddTagsToResource",
    "rds:RemoveTagsFromResource",
)


def seeder_policy_document(
    declaration: InfraDeclaration, values: dict[str, str], is_emulator: bool, user_arn: str
) -> dict[str, Any]:
    """Least privilege on the ledger: the s3 state plane plus the management
    surface of only the declared fabrics — no other resource class anywhere."""
    region = resolve_region(declaration, values)
    # The fabric/bucket ARNs ride the plane account: the emulator places every
    # resource in one account whatever the trust placeholder says.
    account = DEFAULT_ACCOUNT_ID if is_emulator else iam_account_id(user_arn)
    bucket = state_bucket_for(declaration.slug, account)
    statements: list[dict[str, Any]] = [
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
    ]
    if declaration.queue_ledger:
        statements.append(
            {
                "Sid": "ManageQueueFabric",
                "Effect": "Allow",
                "Action": list(QUEUE_ACTIONS),
                "Resource": [
                    f"arn:aws:sqs:{region}:{account}:{entry.name}"
                    for entry in declaration.queue_ledger
                ],
            }
        )
    if declaration.cache_ledger:
        statements.append(
            {
                "Sid": "ManageCacheFabric",
                "Effect": "Allow",
                "Action": list(CACHE_ACTIONS),
                "Resource": [
                    f"arn:aws:elasticache:{region}:{account}:serverlesscache:{entry.name}"
                    for entry in declaration.cache_ledger
                ],
            }
        )
    if declaration.aurora_ledger:
        resources: list[str] = []
        for entry in declaration.aurora_ledger:
            resources.append(f"arn:aws:rds:{region}:{account}:cluster:{entry.name}")
            resources.append(f"arn:aws:rds:{region}:{account}:db:{entry.name}-writer")
            resources.extend(
                f"arn:aws:rds:{region}:{account}:db:{entry.name}-reader-{index}"
                for index in range(1, entry.num_read_replicas + 1)
            )
            resources.append(f"arn:aws:rds:{region}:{account}:subgrp:{entry.name}-subnet-group")
        statements.append(
            {
                "Sid": "ManageDatabaseFabric",
                "Effect": "Allow",
                "Action": list(RDS_ACTIONS),
                "Resource": resources,
            }
        )
    return {"Version": "2012-10-17", "Statement": statements}
