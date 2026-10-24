locals {
  # Same flick protocol as the shared infra stack: a non-empty endpoint targets
  # the emulator (test creds, skip flags), empty/null targets real AWS.
  effective_endpoint = (
    try(trimspace(var.emulator_endpoint), "") != ""
    ? trimspace(var.emulator_endpoint)
    : null
  )
  is_emulator = local.effective_endpoint != null

  # IAM policy documents need an account id for every ARN: on real AWS it comes
  # from caller identity; on the emulator the data source is skipped (the
  # provider is told to skip account-id resolution anyway) and the var pins it,
  # defaulting to the emulator's own 000000000000. Ignored on real AWS.
  account_id = local.is_emulator ? coalesce(var.aws_account_id, "000000000000") : data.aws_caller_identity.current[0].account_id

  common_tags = {
    Project   = "detectai"
    ManagedBy = "terraform"
  }
}

# Real AWS only: the account id lands in every IAM-managed ARN. Counted out on
# the emulator, where the pinned/defaulted var takes over instead (see locals).
data "aws_caller_identity" "current" {
  count = local.is_emulator ? 0 : 1
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
