# Workers: cross-worker error share, cron sweeper lag, dead-letter growth and
# broker connectivity (the scrape-fed counters the FROM Metric panels chart).
module "workers_error_rate" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["workers"].id
  name        = "Worker error share high"
  description = "Any worker's span error share over 10 minutes. Covers analytics, payments and cron."
  query       = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE service.name LIKE 'worker-%' AND deployment.environment = '${var.environment}'"

  critical = {
    operator    = "above"
    threshold   = 2
    duration    = 600
    occurrences = "ALL"
  }
}

# Sweeps run every CRON_CHECK_INTERVAL_MS (15m default) with jitter, so a lag
# above 2x the interval means a stalled sweeper. Read as a gauge, not tick
# counts, so it still fires when log delivery is what broke. Keeps 24h.
module "cron_expiry_lag" {
  source = "../modules/alert-condition"

  account_id                   = var.account_id
  policy_id                    = newrelic_alert_policy.area["workers"].id
  name                         = "Cron expiry lag high"
  description                  = "Oldest expired subscription has waited over 30 minutes (2x the default 15m sweep interval)."
  query                        = "FROM Metric SELECT latest(worker_cron_expiry_lag_seconds) AS lag_seconds WHERE service = 'worker-cron' AND deployment.environment = '${var.environment}'"
  violation_time_limit_seconds = 86400

  critical = {
    operator    = "above"
    threshold   = 1800
    duration    = 900
    occurrences = "ALL"
  }
}

module "workers_dead_letter_growth" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["workers"].id
  name        = "Workers dead-lettering messages"
  description = "Any worker is sending messages to the DLQ. Usually UserNotFoundError or an invalid subscription state transition."
  query       = "FROM Metric SELECT rate(sum(worker_dead_lettered_total), 1 minute) AS dlq_per_minute WHERE deployment.environment = '${var.environment}'"

  critical = {
    operator    = "above"
    threshold   = 0
    duration    = 300
    occurrences = "ALL"
  }
}

# Gauges need a fill to survive quiet scrape windows: an absent series must
# read as connected-forever, not as an alertless gap.
module "workers_broker_disconnected" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["workers"].id
  name        = "Workers disconnected from RabbitMQ"
  description = "Any queue-consuming worker reports rabbitmq_connection_status below 1. Consumers cannot make progress while disconnected."
  query       = "FROM Metric SELECT min(rabbitmq_connection_status) AS connected WHERE service IN ('worker-analytics', 'worker-payments') AND deployment.environment = '${var.environment}'"
  fill        = 1

  critical = {
    operator    = "below"
    threshold   = 1
    duration    = 120
    occurrences = "ALL"
  }
}
