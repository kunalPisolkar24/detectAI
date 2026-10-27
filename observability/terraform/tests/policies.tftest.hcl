mock_provider "newrelic" {}

variables {
  newrelic_account_id = 123456
  newrelic_api_key    = "NRAK-TEST-KEY-DO-NOT-USE"
  newrelic_region     = "EU"
  alert_email         = "kpisolkar24@gmail.com"
}

run "policies_fanout" {
  command = plan

  assert {
    condition     = length(module.alerts.policies) == 7
    error_message = "Seven policies: web, payment_gateway, workers, inference, document_parser, chats, pipeline."
  }

  assert {
    condition     = module.alerts.policies["web"].name == "detectai-web-prod"
    error_message = "Alert policies must carry the environment-suffixed names."
  }

  assert {
    condition     = module.alerts.workflow_name == "detectai-email-all-prod"
    error_message = "The email workflow must be planned."
  }
}
