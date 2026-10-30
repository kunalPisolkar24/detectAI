# Inference board: AI service, prod only (no dev twin — the rigs never run it).
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
