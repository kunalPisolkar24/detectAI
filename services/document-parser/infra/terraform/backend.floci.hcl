# Emulator S3 backend (Floci/LocalStack) — the emulator-plane state ledger.
# Disposable by design: it lives in the floci volume, like the root stack's
# backend.local-s3.hcl. Bucket must exist before the first init.
#   aws --endpoint-url http://localhost:4566 s3 mb s3://detectai-tfstate-local --region ap-south-1
# tools/secrets.py passes exactly this file when EMULATOR_ENDPOINT is set.

bucket                      = "detectai-tfstate-local"
key                         = "document-parser/floci/terraform.tfstate"
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
