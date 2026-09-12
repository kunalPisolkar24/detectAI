#!/usr/bin/env bash
set -euo pipefail
# Fetch Amazon MQ secret (detectai/mq/urls) and export as env for gateway.
# Usage: ./scripts/fetch-mq-secret.sh [secret-name] [region]
# Requires: aws cli + jq, IAM permission secretsmanager:GetSecretValue
SECRET_NAME="${1:-${MQ_SECRETS_NAME:-detectai/mq/urls}}"
REGION="${2:-${AWS_REGION:-ap-south-1}}"
echo "Fetching secret $SECRET_NAME in $REGION..." >&2
SECRET_JSON=$(aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --region "$REGION" --query SecretString --output text)
echo "$SECRET_JSON" | jq -r '
  "RABBITMQ_URL=\(.RABBITMQ_URL)",
  "RABBITMQ_QUEUE_TYPE=\(.RABBITMQ_QUEUE_TYPE // \"quorum\")",
  "RABBITMQ_UI_URL=\(.RABBITMQ_UI_URL // \"\")"
'
echo "# To export: eval \$(./scripts/fetch-mq-secret.sh)" >&2
echo "# Or write to deployments/.env: ./scripts/fetch-mq-secret.sh > deployments/.env.aws" >&2
