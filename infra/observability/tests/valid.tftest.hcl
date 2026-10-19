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
    condition     = length(newrelic_one_dashboard_json.dashboards) == 12
    error_message = "Expected 12 dashboards."
  }

  assert {
    condition     = length(jsondecode(newrelic_one_dashboard_json.dashboards["workers"].json).pages) == 8
    error_message = "workers board must have 8 pages."
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
