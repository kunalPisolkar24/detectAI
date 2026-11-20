# Inference board: AI service. Dev twin panel-identical.
module "inference" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/inference/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "inference"
  kind  = "service-dashboard"
  env   = var.environment
}

module "inference_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/inference/dev.tftpl", {
    account_id = var.account_id
  })
  scope = "inference"
  kind  = "service-dashboard"
  env   = "dev"
}
