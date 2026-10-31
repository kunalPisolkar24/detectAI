module "document_parser" {
  source                 = "./modules/document-parser"
  secrets_name           = var.secrets_name
  api_key                = var.api_key
  new_relic_license_key  = var.new_relic_license_key
  secret_recovery_window = var.secret_recovery_window
  aws_region             = var.aws_region
  ssm_parameters         = var.ssm_parameters
}
