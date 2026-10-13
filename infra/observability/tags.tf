# Dashboard grouping tags (team/service/env/kind) so boards are filterable
# instead of one flat list. Wired to dashboard GUIDs; the loadtest board
# always carries env=loadtest even when deployed from the prod workspace.
locals {
  dashboard_scope = {
    overview                 = "platform"
    web                      = "web"
    payment-gateway          = "payment-gateway"
    worker-analytics         = "worker-analytics"
    worker-payments          = "worker-payments"
    worker-cron              = "worker-cron"
    inference                = "inference"
    document-parser          = "document-parser"
    document-parser-loadtest = "document-parser"
    chats                    = "chats"
    datastores               = "datastores"
  }

  dashboard_kind = {
    overview                 = "platform"
    web                      = "service-dashboard"
    payment-gateway          = "service-dashboard"
    worker-analytics         = "service-dashboard"
    worker-payments          = "service-dashboard"
    worker-cron              = "service-dashboard"
    inference                = "service-dashboard"
    document-parser          = "service-dashboard"
    document-parser-loadtest = "loadtest"
    chats                    = "service-dashboard"
    datastores               = "platform"
  }

  dashboard_env = {
    for k in keys(local.dashboard_scope) :
    k => k == "document-parser-loadtest" ? "loadtest" : var.environment
  }
}

resource "newrelic_entity_tags" "dashboards" {
  for_each = local.dashboard_scope
  guid     = newrelic_one_dashboard_json.dashboards[each.key].guid

  tag {
    key    = "team"
    values = ["detectai"]
  }

  tag {
    key    = "managed-by"
    values = ["terraform"]
  }

  tag {
    key    = "service"
    values = [each.value]
  }

  tag {
    key    = "env"
    values = [local.dashboard_env[each.key]]
  }

  tag {
    key    = "kind"
    values = [local.dashboard_kind[each.key]]
  }
}
