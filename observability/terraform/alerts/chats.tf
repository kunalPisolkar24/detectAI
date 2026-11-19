# Chats: ConnectRPC error share. The service stamps deployment.environment and
# service.name itself — it pushes straight to New Relic, outside the collector.
module "chats_rpc_error_share" {
  source = "../modules/alert-condition"

  account_id  = var.account_id
  policy_id   = newrelic_alert_policy.area["chats"].id
  name        = "Chats RPC error share high"
  description = "ConnectRPC error share above 2% for 10 minutes."

  query = "FROM Span SELECT percentage(count(*), WHERE error = true) AS `error %` WHERE deployment.environment = '${var.environment}' AND service.name = 'chats' AND rpc.system = 'connect_rpc'"

  critical = {
    operator    = "above"
    threshold   = 2
    duration    = 600
    occurrences = "ALL"
  }
}
