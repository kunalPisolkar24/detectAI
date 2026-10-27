# Chats: Redis degraded flag shared by chat-service and chat-worker. Gauge
# condition reads the scrape-fed counter.
module "chats_redis_degraded" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["chats"].id
  name        = "Chats Redis degraded"
  description = "Chat Redis degraded flag set over 5 minutes."
  query       = "FROM Metric SELECT max(chat_redis_degraded) AS degraded WHERE deployment.environment = '${var.environment}' AND service.name IN ('chat-service', 'chat-worker')"

  critical = {
    operator    = "above_or_equals"
    threshold   = 1
    duration    = 300
    occurrences = "ALL"
  }
}
