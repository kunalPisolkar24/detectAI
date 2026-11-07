locals {
  # Non-empty endpoint = emulator (test creds, skip flags); empty/null = real AWS.
  effective_endpoint = (
    try(trimspace(var.emulator_endpoint), "") != ""
    ? trimspace(var.emulator_endpoint)
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

  endpoints {
    secretsmanager = local.effective_endpoint
    ssm            = local.effective_endpoint
    iam            = local.effective_endpoint
    sts            = local.effective_endpoint
  }

  default_tags {
    tags = local.common_tags
  }
}
