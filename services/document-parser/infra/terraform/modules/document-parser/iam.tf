# Runtime read identity: secrets blob + SSM config ARNs, no S3 (stateless app);
# account-root trust until the runtime host's principal materializes.
# jsonencode beats aws_iam_policy_document: static shapes stay deterministic under
# terraform test's mocked provider, which cannot parse policy documents.
# The deploy role is out-of-stack (tools/secrets.py iam-bootstrap) — terraform never manages itself.

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
        # The - suffix: AWS appends a random 6-char tail to secret ARNs.
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
