# Workers board: all three worker deployables on one board. The dev twin
# keeps every panel but swaps the Paddle panel for the rigs' cancel path.
module "workers" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/workers/prod.tftpl", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "workers"
  kind  = "service-dashboard"
  env   = var.environment
}

module "workers_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/workers/dev.tftpl", {
    account_id = var.account_id
  })
  scope = "workers"
  kind  = "service-dashboard"
  env   = "dev"
}
