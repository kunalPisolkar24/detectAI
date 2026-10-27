# Document parser: server-span error share, extract p95, failed extractions,
# queue saturation and upload rejections.
module "parser_error_rate" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["document_parser"].id
  name        = "Parser error share high"
  description = "Document parser error share over 10 minutes."
  query       = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name = 'document-parser' AND deployment.environment = '${var.environment}' AND span.kind = 'server'"

  critical = {
    operator    = "above"
    threshold   = 2
    duration    = 600
    occurrences = "ALL"
  }
}

module "parser_p95" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["document_parser"].id
  name        = "Parser p95 latency high"
  description = "Document parser extract p95 over 10 minutes."
  query       = "FROM Span SELECT percentile(duration.ms, 95) AS `p95` WHERE service.name = 'document-parser' AND deployment.environment = '${var.environment}' AND span.kind = 'server' AND http.route = '/api/v1/extract'"

  warning = {
    operator    = "above"
    threshold   = 2000
    duration    = 600
    occurrences = "ALL"
  }

  critical = {
    operator    = "above"
    threshold   = 3000
    duration    = 300
    occurrences = "ALL"
  }
}

module "parser_extraction_errors" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["document_parser"].id
  name        = "Parser extraction failures"
  description = "Failed extraction spans (timeouts, corrupt docs) in 5 minutes."
  query       = "FROM Span SELECT count(*) AS failures WHERE service.name = 'document-parser' AND deployment.environment = '${var.environment}' AND name = 'extraction' AND error = true"

  critical = {
    operator    = "above"
    threshold   = 5
    duration    = 300
    occurrences = "ALL"
  }
}

module "parser_queue_saturated" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["document_parser"].id
  name        = "Parser queue saturated"
  description = "Extraction pool queue depth near READINESS_MAX_QUEUE_DEPTH (default 50)."
  query       = "FROM Metric SELECT average(extraction_pool_queue_depth) AS `queue depth` WHERE deployment.environment = '${var.environment}'"

  warning = {
    operator    = "above"
    threshold   = 40
    duration    = 300
    occurrences = "ALL"
  }
}

module "parser_rejections_spike" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["document_parser"].id
  name        = "Parser rejections spike"
  description = "Upload rejections (too large, unsupported type) per minute over 5 minutes."
  query       = "FROM Metric SELECT rate(sum(rejected_uploads_total), 1 minute) AS `rejections/min` WHERE deployment.environment = '${var.environment}'"

  warning = {
    operator    = "above"
    threshold   = 10
    duration    = 300
    occurrences = "ALL"
  }
}
