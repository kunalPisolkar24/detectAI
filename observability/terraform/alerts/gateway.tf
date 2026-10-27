# Payment gateway: webhook 5xx share and MQ publish failures (log-based).
module "gateway_5xx" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["payment_gateway"].id
  name        = "Gateway 5xx share high"
  description = "Payment gateway 5xx share over 5 minutes."
  query       = "FROM Span SELECT percentage(count(*), WHERE `http.status_code` >= '500') AS `5xx %` WHERE service.name = 'payment-gateway' AND deployment.environment = '${var.environment}' AND span.kind = 'SERVER'"

  critical = {
    operator    = "above"
    threshold   = 1
    duration    = 300
    occurrences = "ALL"
  }
}

module "gateway_mq_publish_fail" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["payment_gateway"].id
  name        = "Gateway MQ publish failures"
  description = "Any MQ publish failure in 5 minutes."
  query       = "FROM Log SELECT count(*) WHERE service.name = 'payment-gateway' AND deployment.environment = '${var.environment}' AND (message LIKE '%mq%publish%fail%' OR message LIKE '%rabbitmq%fail%')"

  critical = {
    operator    = "above"
    threshold   = 0
    duration    = 300
    occurrences = "ALL"
  }
}
