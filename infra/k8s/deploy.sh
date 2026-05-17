#!/usr/bin/env bash

# ==============================================================================
# Detect AI - Kubernetes Deploy Script
# ==============================================================================
# Automates the extraction of app variables into secrets, parses image tags
# dynamically from env files, and triggers a clean Helm upgrade/install.
# ==============================================================================

set -euo pipefail

# Print help/usage
usage() {
  echo "Usage: $0 [dev|prod]"
  echo "  dev  : Deploys to detect-ai namespace using envs/.env.dev and values-dev.yaml"
  echo "  prod : Deploys to detect-ai-prod namespace using envs/.env.prod and values-prod.yaml"
  exit 1
}

# Validate argument
if [ $# -lt 1 ]; then
  usage
fi

ENV=$1
if [ "$ENV" != "dev" ] && [ "$ENV" != "prod" ]; then
  echo "Error: Invalid environment '$ENV'."
  usage
fi

# Define paths and names
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/envs/.env.${ENV}"
CHART_DIR="${SCRIPT_DIR}/charts/detect-ai"
VALUES_FILE="${CHART_DIR}/values-${ENV}.yaml"

if [ "$ENV" == "dev" ]; then
  NAMESPACE="detect-ai"
  RELEASE_NAME="staging"
else
  NAMESPACE="detect-ai-prod"
  RELEASE_NAME="prod"
fi

# Check for necessary CLI tools
for tool in kubectl helm; do
  if ! command -v "$tool" &> /dev/null; then
    echo "Error: Required CLI tool '$tool' is not installed or not in PATH."
    exit 1
  fi
done

# Verify env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Environment file '$ENV_FILE' not found."
  echo "Please copy the corresponding .example file and populate it before running."
  echo "Example: cp ${ENV_FILE}.example ${ENV_FILE}"
  exit 1
fi

echo "======================================================================"
echo " Starting Detect AI Kubernetes Deployment [$ENV]"
echo " Namespace    : $NAMESPACE"
echo " Release Name : $RELEASE_NAME"
echo " Env File     : $ENV_FILE"
echo "======================================================================"

# Step 1: Create a safe filtered temporary env file for Secret creation
# We filter out comments, blank lines, and K8S_ prefixed variables to keep secrets clean.
TEMP_FILTERED_ENV=$(mktemp)
trap 'rm -f "$TEMP_FILTERED_ENV"' EXIT

grep -v '^#' "$ENV_FILE" | grep -v '^[[:space:]]*$' | grep -v '^K8S_IMAGE_' > "$TEMP_FILTERED_ENV"

# Step 2: Ensure the target namespace exists
echo "--> Ensuring namespace '$NAMESPACE' exists..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Step 3: Create or update the Kubernetes Secret (Base64 is automatically handled by kubectl)
echo "--> Syncing secrets inside Kubernetes..."
kubectl create secret generic detect-ai-secrets \
  --from-env-file="$TEMP_FILTERED_ENV" \
  --namespace "$NAMESPACE" \
  --dry-run=client -o yaml | kubectl apply -f -

# Step 4: Dynamically parse the K8S image repositories and tags from the Env File
echo "--> Extracting image metadata..."

# Helper function to read variables from env file
get_env_val() {
  local key=$1
  local val
  val=$(grep "^${key}=" "$ENV_FILE" | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  echo "$val"
}

K8S_REPO_WEB=$(get_env_val "K8S_IMAGE_REPO_WEB")
K8S_TAG_WEB=$(get_env_val "K8S_IMAGE_TAG_WEB")

K8S_REPO_DOC_PARSER=$(get_env_val "K8S_IMAGE_REPO_DOC_PARSER")
K8S_TAG_DOC_PARSER=$(get_env_val "K8S_IMAGE_TAG_DOC_PARSER")

K8S_REPO_INFERENCE=$(get_env_val "K8S_IMAGE_REPO_INFERENCE")
K8S_TAG_INFERENCE=$(get_env_val "K8S_IMAGE_TAG_INFERENCE")

K8S_REPO_CHATS=$(get_env_val "K8S_IMAGE_REPO_CHATS")
K8S_TAG_CHATS=$(get_env_val "K8S_IMAGE_TAG_CHATS")

K8S_REPO_PAYMENTS=$(get_env_val "K8S_IMAGE_REPO_PAYMENTS")
K8S_TAG_PAYMENTS=$(get_env_val "K8S_IMAGE_TAG_PAYMENTS")

K8S_REPO_WORKERS=$(get_env_val "K8S_IMAGE_REPO_WORKERS")
K8S_TAG_WORKERS=$(get_env_val "K8S_IMAGE_TAG_WORKERS")

# Step 5: Perform Helm Upgrade / Install with dynamic values injection
echo "--> Adding required Helm repositories..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts --force-update
helm repo update

echo "--> Building Helm Chart dependencies..."
helm dependency build "$CHART_DIR"

echo "--> Initiating Helm deployment..."

helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --create-namespace \
  -f "$VALUES_FILE" \
  --set web.image.repository="$K8S_REPO_WEB" \
  --set web.image.tag="$K8S_TAG_WEB" \
  --set documentParser.image.repository="$K8S_REPO_DOC_PARSER" \
  --set documentParser.image.tag="$K8S_TAG_DOC_PARSER" \
  --set inference.image.repository="$K8S_REPO_INFERENCE" \
  --set inference.image.tag="$K8S_TAG_INFERENCE" \
  --set chats.image.repository="$K8S_REPO_CHATS" \
  --set chats.image.tag="$K8S_TAG_CHATS" \
  --set payments.image.repository="$K8S_REPO_PAYMENTS" \
  --set payments.image.tag="$K8S_TAG_PAYMENTS" \
  --set workers.image.repository="$K8S_REPO_WORKERS" \
  --set workers.image.tag="$K8S_TAG_WORKERS"

echo "======================================================================"
echo " Deployment Successfully Completed!"
echo "======================================================================"
