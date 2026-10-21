# Dashboard grouping tags (team/service/env/kind) so boards are filterable
# instead of one flat list. Wired to dashboard GUIDs; the loadtest board
# always carries env=loadtest even when deployed from the prod workspace.
locals {
  dashboard_scope = {
    overview                 = "platform"
    web                      = "web"
    web-loadtest             = "web"
    payment-gateway          = "payment-gateway"
    payment-gateway-loadtest = "payment-gateway"
    workers                  = "workers"
    workers-loadtest         = "workers"
    inference                = "inference"
    document-parser          = "document-parser"
    document-parser-loadtest = "document-parser"
    chats                    = "chats"
    chats-loadtest           = "chats"
    datastores               = "datastores"
  }

  dashboard_kind = {
    overview                 = "platform"
    web                      = "service-dashboard"
    web-loadtest             = "loadtest"
    payment-gateway          = "service-dashboard"
    payment-gateway-loadtest = "loadtest"
    workers                  = "service-dashboard"
    workers-loadtest         = "loadtest"
    inference                = "service-dashboard"
    document-parser          = "service-dashboard"
    document-parser-loadtest = "loadtest"
    chats                    = "service-dashboard"
    chats-loadtest           = "loadtest"
    datastores               = "platform"
  }

  dashboard_env = {
    for k in keys(local.dashboard_scope) :
    k => contains(["document-parser-loadtest", "payment-gateway-loadtest", "chats-loadtest", "workers-loadtest", "web-loadtest"], k) ? "loadtest" : "prod"
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
