# Platform board: the whole estate in one place, prod only.
module "overview" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/overview/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "platform"
  kind  = "platform"
  env   = var.environment
}
