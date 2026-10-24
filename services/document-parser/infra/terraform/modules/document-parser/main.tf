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

# Blob being the contract: {"API_KEY": "<the shared key>"}. Consumers pull the
# whole blob at boot and pick the named key, so adding keys later is entirely a
# terraform change — no consumer-side schema migration.
resource "aws_secretsmanager_secret" "services" {
  name                    = var.secrets_name
  description             = "DetectAI document-parser secrets blob."
  recovery_window_in_days = var.secret_recovery_window
}

resource "aws_secretsmanager_secret_version" "services" {
  count = var.api_key == null ? 0 : 1

  secret_id     = aws_secretsmanager_secret.services.id
  secret_string = jsonencode({ API_KEY = var.api_key })
}
