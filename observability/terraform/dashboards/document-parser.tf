# Document parser board: FastAPI extraction service. Dev twin panel-identical.
module "document_parser" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/document-parser/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "document-parser"
  kind  = "service-dashboard"
  env   = var.environment
}

module "document_parser_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/document-parser/dev.tftpl", {
    account_id = var.account_id
  })
  scope = "document-parser"
  kind  = "service-dashboard"
  env   = "dev"
}
