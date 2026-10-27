# Datastore board: Postgres, Redis, MongoDB, RabbitMQ health, prod only.
module "datastores" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/prod/datastores.json", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "datastores"
  kind  = "platform"
  env   = var.environment
}
