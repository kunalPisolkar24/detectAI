# Pipeline: collector export failures to EU. Covers the OTLP relay path the
# prod stack still routes through.
module "collector_export_failed" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["pipeline"].id
  name        = "Collector export failing"
  description = "Collector OTLP export failures to EU in 5 minutes."
  query       = "FROM Metric SELECT sum(otelcol_exporter_send_failed_spans) AS failed WHERE service.name = 'otel-collector' AND deployment.environment = '${var.environment}'"

  critical = {
    operator    = "above"
    threshold   = 0
    duration    = 300
    occurrences = "ALL"
  }
}
