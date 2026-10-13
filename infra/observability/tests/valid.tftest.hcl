mock_provider "newrelic" {}

variables {
  newrelic_account_id = 6428768
  newrelic_api_key    = "NRAK-TEST-KEY-DO-NOT-USE"
  newrelic_region     = "EU"
  environment         = "floci"
  alert_email         = "kpisolkar24@gmail.com"
  service_version     = "0.1.0"
}

run "dashboards_render" {
  command = plan

  assert {
    condition     = length(newrelic_one_dashboard_json.dashboards) == 11
    error_message = "Expected 11 dashboards."
  }
}

run "policies_exist" {
  command = plan

  assert {
    condition     = newrelic_workflow.email_all.name == "detectai-email-all-floci"
    error_message = "Email workflow must be planned."
  }

  assert {
    condition     = newrelic_alert_policy.web.name == "detectai-web-floci"
    error_message = "Alert policies must be planned."
  }
}
