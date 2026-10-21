mock_provider "newrelic" {}

variables {
  newrelic_account_id = 6428768
  newrelic_api_key    = "NRAK-TEST-KEY-DO-NOT-USE"
  newrelic_region     = "EU"
  alert_email         = "kpisolkar24@gmail.com"
  service_version     = "0.1.0"
}

run "dashboards_render" {
  command = plan

  assert {
    condition     = length(newrelic_one_dashboard_json.dashboards) == 13
    error_message = "Expected 13 dashboards."
  }

  assert {
    condition     = length(jsondecode(newrelic_one_dashboard_json.dashboards["workers"].json).pages) == 8
    error_message = "workers board must have 8 pages."
  }

  assert {
    condition     = length(jsondecode(newrelic_one_dashboard_json.dashboards["web"].json).pages) == 4
    error_message = "web board must have 4 pages."
  }

  # The chats boards are twins: same pages, same panels, only the env filter and
  # the "(load)" title suffix differ. Drift here means prod lost coverage.
  assert {
    condition = (
      [for p in jsondecode(newrelic_one_dashboard_json.dashboards["chats"].json).pages : p.name] ==
      [for p in jsondecode(newrelic_one_dashboard_json.dashboards["chats-loadtest"].json).pages : p.name]
    )
    error_message = "Chats prod board must have the same pages as the chats loadtest board."
  }

  assert {
    condition = (
      { for p in jsondecode(newrelic_one_dashboard_json.dashboards["chats"].json).pages : p.name => [for w in p.widgets : lookup(w, "title", "")] } ==
      { for p in jsondecode(newrelic_one_dashboard_json.dashboards["chats-loadtest"].json).pages : p.name => [for w in p.widgets : trimsuffix(lookup(w, "title", ""), " (load)")] }
    )
    error_message = "Chats prod board must have the same panels as the chats loadtest board."
  }

  # Same contract for the web boards: the loadtest twin has to keep the same
  # pages and panels as prod, so a panel added to one cannot be forgotten in
  # the other.
  assert {
    condition = (
      [for p in jsondecode(newrelic_one_dashboard_json.dashboards["web"].json).pages : p.name] ==
      [for p in jsondecode(newrelic_one_dashboard_json.dashboards["web-loadtest"].json).pages : p.name]
    )
    error_message = "Web prod board must have the same pages as the web loadtest board."
  }

  assert {
    condition = (
      { for p in jsondecode(newrelic_one_dashboard_json.dashboards["web"].json).pages : p.name => [for w in p.widgets : lookup(w, "title", "")] } ==
      { for p in jsondecode(newrelic_one_dashboard_json.dashboards["web-loadtest"].json).pages : p.name => [for w in p.widgets : trimsuffix(lookup(w, "title", ""), " (load)")] }
    )
    error_message = "Web prod board must have the same panels as the web loadtest board."
  }

  # The AI inference panels are split per model on purpose: one faceted chart
  # put Flare and Spark on the same axis, where Spark's scale hid Flare's
  # latency. Each panel must stay, and each must filter on its own model.
  assert {
    condition = (
      [for w in one([for p in jsondecode(newrelic_one_dashboard_json.dashboards["web"].json).pages : p if p.name == "Service"]).widgets : w.title] ==
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
      [for w in one([for p in jsondecode(newrelic_one_dashboard_json.dashboards["web"].json).pages : p if p.name == "Service"]).widgets : w.rawConfiguration.nrqlQueries[0].query if strcontains(w.title, "inference latency")] ==
      [
        "FROM Metric SELECT percentile(ai_inference_duration_seconds, 50, 95, 99) WHERE deployment.environment = 'prod' AND service.name = 'web' AND model = 'spark' TIMESERIES AUTO",
        "FROM Metric SELECT percentile(ai_inference_duration_seconds, 50, 95, 99) WHERE deployment.environment = 'prod' AND service.name = 'web' AND model = 'flare' TIMESERIES AUTO",
      ]
    )
    error_message = "The Spark and Flare inference panels must each filter on their own model."
  }
}

run "policies_exist" {
  command = plan

  assert {
    condition     = newrelic_workflow.email_all.name == "detectai-email-all-prod"
    error_message = "Email workflow must be planned."
  }

  assert {
    condition     = newrelic_alert_policy.web.name == "detectai-web-prod"
    error_message = "Alert policies must be planned."
  }
}
