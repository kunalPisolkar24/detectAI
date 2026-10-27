mock_provider "newrelic" {}

variables {
  newrelic_account_id = 6428768
  newrelic_api_key    = "NRAK-TEST-KEY-DO-NOT-USE"
  newrelic_region     = "EU"
  alert_email         = "kpisolkar24@gmail.com"
}

run "boards_render" {
  command = plan

  assert {
    condition     = length(module.dashboards.boards) == 13
    error_message = "Expected 13 boards: 8 prod + 5 dev twins."
  }

  assert {
    condition     = length(jsondecode(module.dashboards.boards["workers"].json).pages) == 8
    error_message = "workers board must have 8 pages."
  }

  assert {
    condition     = length(jsondecode(module.dashboards.boards["web"].json).pages) == 4
    error_message = "web board must have 4 pages."
  }

  # Twin contract part 1: every dev twin keeps its prod board's pages,
  # page-for-page. Drift here means one side lost coverage.
  assert {
    condition = alltrue([
      for base in ["web", "payment-gateway", "workers", "document-parser", "chats"] :
      [for p in jsondecode(module.dashboards.boards[base].json).pages : p.name] ==
      [for p in jsondecode(module.dashboards.boards["${base}-dev"].json).pages : p.name]
    ])
    error_message = "Every dev twin must keep the prod board's pages."
  }

  # Twin contract part 2: same panel count on every page of every twin.
  assert {
    condition = alltrue([
      for base in ["web", "payment-gateway", "workers", "document-parser", "chats"] :
      alltrue([
        for i in range(length(jsondecode(module.dashboards.boards[base].json).pages)) :
        length(jsondecode(module.dashboards.boards[base].json).pages[i].widgets) ==
        length(jsondecode(module.dashboards.boards["${base}-dev"].json).pages[i].widgets)
      ])
    ])
    error_message = "Every dev twin page must keep the prod panel count."
  }

  # Twin contract part 3: same panel coverage, layout order tolerated —
  # document-parser's twin reorders by design; the other four match exactly.
  assert {
    condition = alltrue([
      for base in ["web", "payment-gateway", "document-parser", "chats"] :
      alltrue([
        for i in range(length(jsondecode(module.dashboards.boards[base].json).pages)) :
        sort([for w in jsondecode(module.dashboards.boards[base].json).pages[i].widgets : w.title]) ==
        sort([for w in jsondecode(module.dashboards.boards["${base}-dev"].json).pages[i].widgets : trimsuffix(w.title, " (dev)")])
      ])
    ])
    error_message = "Every clean-pair twin must keep the prod panel coverage."
  }

  # Twin contract part 4: web, payment-gateway and chats keep exact panel
  # order with the " (dev)" suffix on twin titles.
  assert {
    condition = alltrue([
      for base in ["web", "payment-gateway", "chats"] :
      alltrue([
        for i in range(length(jsondecode(module.dashboards.boards[base].json).pages)) :
        [for w in jsondecode(module.dashboards.boards[base].json).pages[i].widgets : w.title] ==
        [for w in jsondecode(module.dashboards.boards["${base}-dev"].json).pages[i].widgets : trimsuffix(w.title, " (dev)")]
      ])
    ])
    error_message = "web, payment-gateway and chats twins must keep the prod panel order."
  }

  # Workers' one deliberate deviation: the Payments page swaps prod's
  # "Paddle API latency and cancels" (needs a real Paddle call) for the rig's
  # cancel path.
  assert {
    condition = (
      contains([for w in one([for p in jsondecode(module.dashboards.boards["workers"].json).pages : p if p.name == "Payments"]).widgets : w.title], "Paddle API latency and cancels") &&
      contains([for w in one([for p in jsondecode(module.dashboards.boards["workers-dev"].json).pages : p if p.name == "Payments"]).widgets : trimsuffix(w.title, " (dev)")], "Cancel events/min")
    )
    error_message = "workers Payments page must swap the Paddle panel for the cancel-path panel in dev."
  }

  # The AI inference panels are split per model on purpose: one faceted chart
  # put Flare and Spark on the same axis, where Spark's scale hid Flare's
  # latency. Each panel must stay, and each must filter on its own model.
  assert {
    condition = (
      [for w in one([for p in jsondecode(module.dashboards.boards["web"].json).pages : p if p.name == "Service"]).widgets : w.title] ==
      [
        "Requests by path",
        "Slow requests over 1s",
        "Spark inference latency",
        "Flare inference latency",
        "Auth failures (401/403)",
        "Rate limit rejections",
        "Cache hit and miss",
        "Analytics publish failures",
        "Usage Redis errors and sync fallback",
        "Slowest paths",
      ]
    )
    error_message = "Web board Service page must keep the split Spark/Flare inference panels."
  }

  assert {
    condition = (
      [for w in one([for p in jsondecode(module.dashboards.boards["web"].json).pages : p if p.name == "Service"]).widgets : w.rawConfiguration.nrqlQueries[0].query if strcontains(w.title, "inference latency")] ==
      [
        "FROM Metric SELECT percentile(ai_inference_duration_seconds, 50, 95, 99) WHERE deployment.environment = 'prod' AND service.name = 'web' AND model = 'spark' TIMESERIES AUTO",
        "FROM Metric SELECT percentile(ai_inference_duration_seconds, 50, 95, 99) WHERE deployment.environment = 'prod' AND service.name = 'web' AND model = 'flare' TIMESERIES AUTO",
      ]
    )
    error_message = "The prod Spark and Flare panels must each filter on their own model."
  }

  assert {
    condition = (
      [for w in one([for p in jsondecode(module.dashboards.boards["web-dev"].json).pages : p if p.name == "Service"]).widgets : w.rawConfiguration.nrqlQueries[0].query if strcontains(w.title, "inference latency")] ==
      [
        "FROM Metric SELECT percentile(ai_inference_duration_seconds, 50, 95, 99) WHERE deployment.environment = 'dev' AND service.name = 'web' AND model = 'spark' TIMESERIES AUTO",
        "FROM Metric SELECT percentile(ai_inference_duration_seconds, 50, 95, 99) WHERE deployment.environment = 'dev' AND service.name = 'web' AND model = 'flare' TIMESERIES AUTO",
      ]
    )
    error_message = "The dev twin's Spark and Flare panels must filter the dev data."
  }

  # Log tables need the full width to fit a message column, and the two chart
  # panels sit side by side at half width — the layout every other Logs page
  # already uses.
  assert {
    condition = alltrue([
      for w in one([for p in jsondecode(module.dashboards.boards["web"].json).pages : p if p.name == "Service Logs"]).widgets :
      w.visualization.id != "viz.table" || w.layout.width == 12
    ])
    error_message = "Every table on the web Service Logs page must be full width."
  }

  assert {
    condition = (
      { for w in one([for p in jsondecode(module.dashboards.boards["web"].json).pages : p if p.name == "Service Logs"]).widgets : w.title => [w.layout.column, w.layout.width] if w.visualization.id != "viz.table" } ==
      {
        "Log volume by level" = [1, 6]
        "Errors by message"   = [7, 6]
      }
    )
    error_message = "The web Service Logs chart panels must sit side by side at half width."
  }
}
