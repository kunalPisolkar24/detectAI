# Wiring only. The board and alert layers live in their own modules; this
# root selects the account, the workspace environment label and the alert email.
module "dashboards" {
  source = "./dashboards"

  account_id  = var.newrelic_account_id
  environment = var.environment
}

module "alerts" {
  source = "./alerts"

  account_id  = var.newrelic_account_id
  environment = var.environment
  alert_email = var.alert_email
}
