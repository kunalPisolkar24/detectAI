# Web board: Next.js frontend + BFF. The dev twin mirrors prod panel-for-panel
# and filters the load rigs' data instead ('dev' is hardcoded in the JSON).
module "web" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/web/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "web"
  kind  = "service-dashboard"
  env   = var.environment
}

module "web_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/web/dev.tftpl", {
    account_id = var.account_id
  })
  scope = "web"
  kind  = "service-dashboard"
  env   = "dev"
}
