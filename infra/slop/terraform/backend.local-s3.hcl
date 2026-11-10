# Emulator S3 backend (Floci / LocalStack) — smoke-test prod-like state flow locally.
# Usage:
#   aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1 || true
#   terraform init -reconfigure -backend-config=backend.local-s3.hcl -var-file=envs/floci.tfvars
# This is ephemeral (emulator volume) — local file backend remains the daily default.
# State key retains the historic floci-local/ prefix for backward compat with existing emulator state.

bucket                      = "detectai-tfstate-local"
key                         = "floci-local/terraform.tfstate"
region                      = "ap-south-1"
encrypt                     = false
# use_lockfile requires Terraform >= 1.10 (pinned ~> 1.9 here), so omitted.
skip_credentials_validation = true
skip_metadata_api_check     = true
skip_requesting_account_id  = true
skip_region_validation      = true
use_path_style              = true
endpoints = {
  s3 = "http://localhost:4566"
}
