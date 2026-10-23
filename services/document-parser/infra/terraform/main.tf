module "document_parser" {
  source                 = "./modules/document-parser"
  secrets_name           = var.secrets_name
  api_key                = var.api_key
  secret_recovery_window = var.secret_recovery_window
}
