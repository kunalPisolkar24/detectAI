# Reference only — the script never reads this file: tools/secrets.py composes
# the backend at runtime from the plane EMULATOR_ENDPOINT selects. Use an edited
# copy of a shape below only for manual, scriptless terraform runs.
# Emulator state lives in the Floci volume; bucket = TF_STATE_BUCKET from .env
# when set, else the commented default.
#
#   bucket                      = "detectai-docparser-tfstate"
#   key                         = "document-parser/floci/terraform.tfstate"
#   region                      = "ap-southeast-2"
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

# Real-AWS shape: swap the mock bucket for a unique per-engineer one —
# renaming it re-points terraform at a fresh ledger, nothing migrates.
bucket       = "detectai-docparser-tfstate"
key          = "document-parser/terraform.tfstate"
region       = "ap-southeast-2"
encrypt      = true
use_lockfile = true
