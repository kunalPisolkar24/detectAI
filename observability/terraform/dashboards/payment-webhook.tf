# Payment webhook board: Go/Gin Paddle webhook service. Dev twin panel-identical.
module "payment_webhook" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/payment-webhook/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "payment-webhook"
  kind  = "service-dashboard"
  env   = var.environment
}

module "payment_webhook_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/payment-webhook/dev.tftpl", {
    account_id = var.account_id
  })
  scope = "payment-webhook"
  kind  = "service-dashboard"
  env   = "dev"
}
