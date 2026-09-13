locals {
  # Effective emulator endpoint: emulator_endpoint preferred, floci_endpoint as deprecated alias.
  # Empty string is treated as null (= real AWS). Works for Floci and LocalStack (both http://localhost:4566).
  effective_endpoint = (
    var.emulator_endpoint != null && trimspace(var.emulator_endpoint) != ""
    ? trimspace(var.emulator_endpoint)
    : var.floci_endpoint != null && trimspace(var.floci_endpoint) != ""
    ? trimspace(var.floci_endpoint)
    : null
  )
  is_emulator = local.effective_endpoint != null

  common_tags = {
    Project   = "detectai"
    ManagedBy = "terraform"
  }
}

provider "aws" {
  region     = var.aws_region
  access_key = local.is_emulator ? "test" : null
  secret_key = local.is_emulator ? "test" : null

  skip_credentials_validation = local.is_emulator
  skip_metadata_api_check     = local.is_emulator
  skip_requesting_account_id  = local.is_emulator
  skip_region_validation      = local.is_emulator
  s3_use_path_style           = local.is_emulator

  default_tags {
    tags = local.common_tags
  }

  endpoints {
    rds            = local.effective_endpoint
    docdb          = local.effective_endpoint
    elasticache    = local.effective_endpoint
    mq             = local.effective_endpoint
    secretsmanager = local.effective_endpoint
    ssm            = local.effective_endpoint
    s3             = local.effective_endpoint
  }
}
