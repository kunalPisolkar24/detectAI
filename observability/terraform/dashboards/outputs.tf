# Boards keyed with prod unsuffixed and dev twins under <key>-dev. Inference
# has no dev twin on purpose, and the two platform boards are prod-only.
locals {
  boards = {
    overview              = module.overview
    datastores            = module.datastores
    web                   = module.web
    "web-dev"             = module.web_dev
    "payment-gateway"     = module.payment_gateway
    "payment-gateway-dev" = module.payment_gateway_dev
    workers               = module.workers
    "workers-dev"         = module.workers_dev
    inference             = module.inference
    "document-parser"     = module.document_parser
    "document-parser-dev" = module.document_parser_dev
    chats                 = module.chats
    "chats-dev"           = module.chats_dev
  }
}

output "boards" {
  description = "Dashboards by key: id, guid, permalink and the rendered json."
  value = {
    for key, board in local.boards : key => {
      id        = board.id
      guid      = board.guid
      permalink = board.permalink
      json      = board.json
    }
  }
}
