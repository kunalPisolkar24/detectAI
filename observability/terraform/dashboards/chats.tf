# Chats board: chat service + chat worker on one board. Dev twin panel-identical.
module "chats" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/chats/prod.json", {
    account_id  = var.account_id
    environment = var.environment
  })
  scope = "chats"
  kind  = "service-dashboard"
  env   = var.environment
}

module "chats_dev" {
  source = "../modules/dashboard"

  account_id = var.account_id
  json = templatefile("${path.module}/chats/dev.json", {
    account_id = var.account_id
  })
  scope = "chats"
  kind  = "service-dashboard"
  env   = "dev"
}
