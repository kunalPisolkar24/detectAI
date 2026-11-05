module "secrets_plane" {
  source                 = "./modules/secrets-plane"
  service_slug           = var.service_slug
  secret_recovery_window = var.secret_recovery_window
  blob                   = var.blob
  ssm_parameters         = var.ssm_parameters
}
