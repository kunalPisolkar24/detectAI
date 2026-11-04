module "secrets_plane" {
  source                 = "../secrets-plane"
  service_slug           = var.service_slug
  aws_region             = var.aws_region
  secret_recovery_window = var.secret_recovery_window
  blob                   = var.blob
  ssm_parameters         = var.ssm_parameters
}
