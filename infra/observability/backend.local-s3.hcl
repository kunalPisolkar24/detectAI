# Emulator S3 backend (Floci / LocalStack) — smoke-test observability state flow locally.
# Usage:
#   aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1 || true
#   terraform init -reconfigure -backend-config=backend.local-s3.hcl -var-file=envs/floci.tfvars
# Ephemeral (emulator volume) — local file backend remains the daily default.

bucket                      = "detectai-tfstate-local"
key                         = "observability/floci/terraform.tfstate"
region                      = "ap-south-1"
encrypt                     = false
skip_credentials_validation = true
skip_metadata_api_check     = true
skip_requesting_account_id  = true
skip_region_validation      = true
use_path_style              = true
endpoints = {
  s3 = "http://localhost:4566"
}
