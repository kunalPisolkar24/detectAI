# Floci mode: every service endpoint points at the emulator, and all
# remote validations are skipped. For real AWS, set floci_endpoint = ""
# and remove this file's endpoints block (or drive it from a variable).
provider "aws" {
  region     = var.aws_region
  access_key = "test"
  secret_key = "test"

  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  skip_region_validation      = true
  s3_use_path_style           = true

  endpoints {
    rds            = var.floci_endpoint
    docdb          = var.floci_endpoint
    secretsmanager = var.floci_endpoint
    ssm            = var.floci_endpoint
  }
}
