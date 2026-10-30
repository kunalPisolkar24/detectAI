# Payment gateway board: Go/Gin Paddle webhook service. Dev twin panel-identical.
module "payment_gateway" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/payment-gateway/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "payment-gateway"
  kind  = "service-dashboard"
  env   = var.environment
}

module "payment_gateway_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/payment-gateway/dev.tftpl", {
    account_id = var.account_id
  })
  scope = "payment-gateway"
  kind  = "service-dashboard"
  env   = "dev"
}
