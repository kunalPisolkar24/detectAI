locals {
  account_id  = var.newrelic_account_id
  environment = var.environment

  dashboards = {
    overview                 = "overview.json"
    web                      = "web.json"
    payment-gateway          = "payment-gateway.json"
    worker-analytics         = "worker-analytics.json"
    worker-payments          = "worker-payments.json"
    worker-cron              = "worker-cron.json"
    inference                = "inference.json"
    document-parser          = "document-parser.json"
    document-parser-loadtest = "document-parser-loadtest.json"
    chats                    = "chats.json"
    datastores               = "datastores.json"
  }
}

resource "newrelic_one_dashboard_json" "dashboards" {
  for_each   = local.dashboards
  account_id = local.account_id
  json = templatefile("${path.module}/dashboards/${each.value}", {
    account_id  = local.account_id
    environment = local.environment
  })
}
