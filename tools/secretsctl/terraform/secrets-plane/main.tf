locals {
  ssm_prefix        = "/detectai/${var.service_slug}/"
  config_parameters = { for name, value in var.ssm_parameters : "${local.ssm_prefix}${name}" => value }
}

resource "aws_ssm_parameter" "config" {
  for_each = local.config_parameters

  name  = each.key
  type  = "String"
  value = each.value

  description = var.ssm_description
}

resource "aws_secretsmanager_secret" "blob" {
  name                    = "detectai/${var.service_slug}/secrets"
  description             = "DetectAI ${var.service_slug} secrets blob."
  recovery_window_in_days = var.secret_recovery_window
}

resource "aws_secretsmanager_secret_version" "blob" {
  count = length(var.blob) == 0 ? 0 : 1

  secret_id     = aws_secretsmanager_secret.blob.id
  secret_string = jsonencode(var.blob)
}
