# Web: server-span errors and latency.
module "web_error_rate" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["web"].id
  name        = "Web 5xx share high"
  description = "Web server-span error share over 5 minutes."
  query       = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name = 'web' AND deployment.environment = '${var.environment}' AND span.kind = 'SERVER'"

  critical = {
    operator    = "above"
    threshold   = 2
    duration    = 300
    occurrences = "ALL"
  }
}

module "web_p95" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["web"].id
  name        = "Web p95 latency high"
  description = "Web p95 over 10 minutes."
  query       = "FROM Span SELECT percentile(duration.ms, 95) AS `p95` WHERE service.name = 'web' AND deployment.environment = '${var.environment}' AND span.kind = 'SERVER'"

  warning = {
    operator    = "above"
    threshold   = 2000
    duration    = 600
    occurrences = "ALL"
  }
}
