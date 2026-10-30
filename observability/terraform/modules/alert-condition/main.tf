# Exactly one NRQL static condition per call site. Shared shape: 60s windows,
# event_flow with a 120s delay. Per-condition variation lives in thresholds
# and the optional static fill.
resource "newrelic_nrql_alert_condition" "condition" {
  account_id                   = var.account_id
  policy_id                    = var.policy_id
  name                         = var.name
  enabled                      = true
  type                         = "static"
  description                  = var.description
  aggregation_window           = var.aggregation_window
  aggregation_method           = "event_flow"
  aggregation_delay            = 120
  violation_time_limit_seconds = var.violation_time_limit_seconds
  fill_option                  = var.fill == null ? null : "static"
  fill_value                   = var.fill

  nrql {
    query = var.query
  }

  dynamic "warning" {
    for_each = var.warning == null ? [] : [var.warning]

    content {
      operator              = warning.value.operator
      threshold             = warning.value.threshold
      threshold_duration    = warning.value.duration
      threshold_occurrences = warning.value.occurrences
    }
  }

  dynamic "critical" {
    for_each = var.critical == null ? [] : [var.critical]

    content {
      operator              = critical.value.operator
      threshold             = critical.value.threshold
      threshold_duration    = critical.value.duration
      threshold_occurrences = critical.value.occurrences
    }
  }
}
