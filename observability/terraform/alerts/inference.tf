# Inference: server-span error share and batch queue drops (log-based).
module "inference_error_rate" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["inference"].id
  name        = "Inference error share high"
  description = "Inference span error share over 10 minutes."
  query       = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name = 'inference' AND deployment.environment = '${var.environment}'"

  critical = {
    operator    = "above"
    threshold   = 2
    duration    = 600
    occurrences = "ALL"
  }
}

module "inference_queue_drops" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["inference"].id
  name        = "Inference queue drops"
  description = "Any batch queue drop in 5 minutes."
  query       = "FROM Log SELECT count(*) WHERE service.name = 'inference' AND deployment.environment = '${var.environment}' AND (message LIKE '%queue%full%' OR message LIKE '%RESOURCE_EXHAUSTED%')"

  critical = {
    operator    = "above"
    threshold   = 0
    duration    = 300
    occurrences = "ALL"
  }
}
