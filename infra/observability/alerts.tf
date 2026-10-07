# Email-only alerting, no Slack/PagerDuty in v1.
# Floci safety: critical conditions are disabled unless environment == prod,
# so test data never sends mail. Warning conditions stay enabled for tuning.
locals {
  is_prod = var.environment == "prod"
  env     = var.environment
}

resource "newrelic_alert_policy" "web" {
  account_id          = var.newrelic_account_id
  name                = "detectai-web-${local.env}"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_alert_policy" "payment_gateway" {
  account_id          = var.newrelic_account_id
  name                = "detectai-payment-gateway-${local.env}"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_alert_policy" "workers" {
  account_id          = var.newrelic_account_id
  name                = "detectai-workers-${local.env}"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_alert_policy" "inference" {
  account_id          = var.newrelic_account_id
  name                = "detectai-inference-${local.env}"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_alert_policy" "document_parser" {
  account_id          = var.newrelic_account_id
  name                = "detectai-document-parser-${local.env}"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_alert_policy" "chats" {
  account_id          = var.newrelic_account_id
  name                = "detectai-chats-${local.env}"
  incident_preference = "PER_CONDITION"
}

resource "newrelic_alert_policy" "pipeline" {
  account_id          = var.newrelic_account_id
  name                = "detectai-pipeline-${local.env}"
  incident_preference = "PER_CONDITION"
}

# --- web ---
resource "newrelic_nrql_alert_condition" "web_error_rate" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.web.id
  name                         = "Web 5xx share high"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Web server-span error share over 5 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name = 'web' AND deployment.environment = '${local.env}' AND span.kind = 'SERVER'"
  }
  critical {
    operator              = "above"
    threshold             = 2
    threshold_duration    = 300
    threshold_occurrences = "ALL"
  }
}

resource "newrelic_nrql_alert_condition" "web_p95" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.web.id
  name                         = "Web p95 latency high"
  enabled                      = true
  type                         = "static"
  description                  = "Web p95 over 10 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Span SELECT percentile(duration.ms, 95) AS `p95` WHERE service.name = 'web' AND deployment.environment = '${local.env}' AND span.kind = 'SERVER'"
  }
  warning {
    operator              = "above"
    threshold             = 2000
    threshold_duration    = 600
    threshold_occurrences = "ALL"
  }
}

# --- gateway ---
resource "newrelic_nrql_alert_condition" "gateway_5xx" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.payment_gateway.id
  name                         = "Gateway 5xx share high"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Payment gateway 5xx share over 5 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Span SELECT percentage(count(*), WHERE `http.status_code` >= '500') AS `5xx %` WHERE service.name = 'payment-gateway' AND deployment.environment = '${local.env}' AND span.kind = 'SERVER'"
  }
  critical {
    operator              = "above"
    threshold             = 1
    threshold_duration    = 300
    threshold_occurrences = "ALL"
  }
}

resource "newrelic_nrql_alert_condition" "gateway_mq_publish_fail" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.payment_gateway.id
  name                         = "Gateway MQ publish failures"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Any MQ publish failure in 5 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Log SELECT count(*) WHERE service.name = 'payment-gateway' AND deployment.environment = '${local.env}' AND (message LIKE '%mq%publish%fail%' OR message LIKE '%rabbitmq%fail%')"
  }
  critical {
    operator              = "above"
    threshold             = 0
    threshold_duration    = 300
    threshold_occurrences = "ALL"
  }
}

# --- workers ---
resource "newrelic_nrql_alert_condition" "workers_error_rate" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.workers.id
  name                         = "Worker error share high"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Analytics/payments worker error share over 10 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name IN ('worker-analytics', 'worker-payments') AND deployment.environment = '${local.env}'"
  }
  critical {
    operator              = "above"
    threshold             = 2
    threshold_duration    = 600
    threshold_occurrences = "ALL"
  }
}

resource "newrelic_nrql_alert_condition" "cron_missed_tick" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.workers.id
  name                         = "Cron missed ticks"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "No cron log events for 30 minutes (2x default 15m interval)."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  fill_option                  = "static"
  fill_value                   = 0
  violation_time_limit_seconds = 86400
  nrql {
    query = "FROM Log SELECT count(*) AS ticks WHERE service.name = 'worker-cron' AND deployment.environment = '${local.env}'"
  }
  critical {
    operator              = "below"
    threshold             = 1
    threshold_duration    = 1800
    threshold_occurrences = "ALL"
  }
}

# --- inference ---
resource "newrelic_nrql_alert_condition" "inference_error_rate" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.inference.id
  name                         = "Inference error share high"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Inference span error share over 10 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name = 'inference' AND deployment.environment = '${local.env}'"
  }
  critical {
    operator              = "above"
    threshold             = 2
    threshold_duration    = 600
    threshold_occurrences = "ALL"
  }
}

resource "newrelic_nrql_alert_condition" "inference_queue_drops" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.inference.id
  name                         = "Inference queue drops"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Any batch queue drop in 5 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Log SELECT count(*) WHERE service.name = 'inference' AND deployment.environment = '${local.env}' AND (message LIKE '%queue%full%' OR message LIKE '%RESOURCE_EXHAUSTED%')"
  }
  critical {
    operator              = "above"
    threshold             = 0
    threshold_duration    = 300
    threshold_occurrences = "ALL"
  }
}

# --- document parser ---
resource "newrelic_nrql_alert_condition" "parser_error_rate" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.document_parser.id
  name                         = "Parser error share high"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Document parser error share over 10 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name = 'document-parser' AND deployment.environment = '${local.env}' AND span.kind = 'SERVER'"
  }
  critical {
    operator              = "above"
    threshold             = 2
    threshold_duration    = 600
    threshold_occurrences = "ALL"
  }
}

# --- chats ---
resource "newrelic_nrql_alert_condition" "chats_redis_degraded" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.chats.id
  name                         = "Chats Redis degraded"
  enabled                      = local.is_prod
  type                         = "static"
  description                  = "Chat Redis degraded flag set over 5 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Metric SELECT max(chat_redis_degraded) AS degraded WHERE deployment.environment = '${local.env}' AND service.name IN ('chat-service', 'chat-worker')"
  }
  critical {
    operator              = "above_or_equals"
    threshold             = 1
    threshold_duration    = 300
    threshold_occurrences = "ALL"
  }
}

# --- pipeline ---
resource "newrelic_nrql_alert_condition" "collector_export_failed" {
  account_id                   = var.newrelic_account_id
  policy_id                    = newrelic_alert_policy.pipeline.id
  name                         = "Collector export failing"
  enabled                      = true
  type                         = "static"
  description                  = "Collector OTLP export failures to EU in 5 minutes."
  aggregation_window           = 60
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = 3600
  nrql {
    query = "FROM Metric SELECT sum(otelcol_exporter_send_failed_spans) AS failed WHERE service.name = 'otel-collector' AND deployment.environment = '${local.env}'"
  }
  critical {
    operator              = "above"
    threshold             = 0
    threshold_duration    = 300
    threshold_occurrences = "ALL"
  }
}
