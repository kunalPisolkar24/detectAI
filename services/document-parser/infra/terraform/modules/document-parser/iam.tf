# Two identities, one plane apart:
#
# - runtime role (this file, in-stack): the service's read identity. Two
#   statements, both pinned to this service's ARNs — the secrets blob and the
#   SSM config prefix. No S3: the app is stateless (requirements.md NFR-1),
#   the state bucket is deploy-tooling territory. Trust is the account root
#   (no service principal yet) — when the runtime host materializes (ECS,
#   EC2, EKS...), its exact principal gets added here as a one-line edit.
# - the deploy role (detectai-document-parser-deploy) is deliberately
#   out-of-stack: tools/secrets.py iam-bootstrap creates it once via the CLI,
#   keeping terraform out of the business of managing its own identity.
#
# Both documents are built with jsonencode rather than the
# aws_iam_policy_document data source: they are static shapes, and emitting
# them in-language keeps them deterministic under terraform test's mocked aws
# provider (the mock cannot parse real policy documents).

locals {
  runtime_assume_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${var.aws_account_id}:root" }
      },
    ]
  }

  runtime_permissions_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadServiceSecret"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        # The - suffix: AWS appends a random 6-char tail to secret ARNs, so the
        # exact name never matches without it.
        Resource = [
          "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:detectai/document-parser/secrets-*",
        ]
      },
      {
        Sid    = "ReadServiceConfig"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath",
        ]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${local.ssm_prefix}*",
        ]
      },
    ]
  }
}

resource "aws_iam_role" "runtime" {
  name               = var.iam_role_name
  description        = "DetectAI document-parser runtime identity (secret + config reads only)."
  assume_role_policy = jsonencode(local.runtime_assume_policy)
}

resource "aws_iam_role_policy" "runtime" {
  name   = "runtime-read"
  role   = aws_iam_role.runtime.name
  policy = jsonencode(local.runtime_permissions_policy)
}
