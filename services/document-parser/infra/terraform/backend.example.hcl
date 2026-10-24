# Reference only — the script never reads this file. tools/secrets.py composes
# the backend config for the plane that EMULATOR_ENDPOINT selects and feeds it
# to `terraform init -reconfigure -backend-config <generated file>`. Use this
# shape (edit a copy) only for manual, scriptless terraform runs.
#
# Emulator plane (EMULATOR_ENDPOINT set: state lives in the Floci volume).
# Bucket: TF_STATE_BUCKET from .env when set, else the default below:
#
#   bucket                      = "detectai-tfstate-local"
#   key                         = "document-parser/floci/terraform.tfstate"
#   region                      = "ap-south-1"
#   encrypt                     = false
#   skip_credentials_validation = true
#   skip_metadata_api_check     = true
#   skip_requesting_account_id  = true
#   skip_region_validation      = true
#   use_path_style              = true
#
#   endpoints = {
#     s3 = "http://localhost:4566"
#   }

bucket       = "REPLACE-me-<unique sandbox bucket>"
key          = "document-parser/terraform.tfstate"
region       = "ap-south-1"
encrypt      = true
use_lockfile = true
