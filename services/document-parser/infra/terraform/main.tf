module "secrets_plane" {
  source                 = "../../../../tools/secretsctl/terraform/secrets-plane"
  service_slug           = var.service_slug
  aws_region             = var.aws_region
  secret_recovery_window = var.secret_recovery_window
  blob                   = var.blob
  ssm_parameters         = var.ssm_parameters
  ssm_description        = var.ssm_description
}

moved {
  from = module.document_parser.aws_secretsmanager_secret.services
  to   = module.secrets_plane.aws_secretsmanager_secret.blob
}

moved {
  from = module.document_parser.aws_secretsmanager_secret_version.services
  to   = module.secrets_plane.aws_secretsmanager_secret_version.blob
}

moved {
  from = module.document_parser.aws_ssm_parameter.config
  to   = module.secrets_plane.aws_ssm_parameter.config
}
