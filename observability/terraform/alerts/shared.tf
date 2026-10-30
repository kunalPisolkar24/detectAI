# One policy per area; conditions live in per-service files and reference
# policies via newrelic_alert_policy.area["<area>"].id. Every condition filters
# deployment.environment = '${var.environment}', so load-rig runs never page.
locals {
  area_policies = {
    web             = "web"
    payment_gateway = "payment-gateway"
    workers         = "workers"
    inference       = "inference"
    document_parser = "document-parser"
    chats           = "chats"
    pipeline        = "pipeline"
  }
}

resource "newrelic_alert_policy" "area" {
  for_each            = local.area_policies
  account_id          = var.account_id
  name                = "detectai-${each.value}-${var.environment}"
  incident_preference = "PER_CONDITION"
}
