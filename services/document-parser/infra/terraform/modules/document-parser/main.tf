locals {
  ssm_prefix        = "/detectai/document-parser/"
  config_parameters = { for name, value in var.ssm_parameters : "${local.ssm_prefix}${name}" => value }
}

resource "aws_ssm_parameter" "config" {
  for_each = local.config_parameters

  name  = each.key
  type  = "String"
  value = each.value

  description = "document-parser runtime config seeded from .env (tools/secrets.py)."
}

# Blob contract: {"API_KEY": ..., "NEW_RELIC_LICENSE_KEY": ...}; consumers pull the whole
# blob and pick names, so adding keys later is a terraform-only change. Null keys store no version.
locals {
  blob = merge(
    var.api_key == null ? {} : { "API_KEY" = var.api_key },
    var.new_relic_license_key == null ? {} : { "NEW_RELIC_LICENSE_KEY" = var.new_relic_license_key },
  )
}

resource "aws_secretsmanager_secret" "services" {
  name                    = var.secrets_name
  description             = "DetectAI document-parser secrets blob."
  recovery_window_in_days = var.secret_recovery_window
}

resource "aws_secretsmanager_secret_version" "services" {
  count = length(local.blob) == 0 ? 0 : 1

  secret_id     = aws_secretsmanager_secret.services.id
  secret_string = jsonencode(local.blob)
}
