# Payment webhook: 5xx share (spans) and SQS enqueue failures (publish counter).
module "payment_webhook_5xx" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["payment_webhook"].id
  name        = "Payment webhook 5xx share high"
  description = "Payment webhook 5xx share over 5 minutes."
  query       = "FROM Span SELECT percentage(count(*), WHERE `http.status_code` >= '500') AS `5xx %` WHERE service.name = 'payment-webhook' AND deployment.environment = '${var.environment}' AND span.kind = 'SERVER'"

  critical = {
    operator    = "above"
    threshold   = 1
    duration    = 300
    occurrences = "ALL"
  }
}

module "payment_webhook_publish_failures" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["payment_webhook"].id
  name        = "Payment webhook publish failures"
  description = "Failed or timed-out SQS enqueues (status IN ('error', 'timeout')) in 5 minutes."
  query       = "FROM Metric SELECT rate(sum(`payment_events_published_total`), 1 minute) AS `errors/min` WHERE service.name = 'payment-webhook' AND deployment.environment = '${var.environment}' AND status IN ('error', 'timeout')"

  critical = {
    operator    = "above"
    threshold   = 0
    duration    = 300
    occurrences = "ALL"
  }
}
