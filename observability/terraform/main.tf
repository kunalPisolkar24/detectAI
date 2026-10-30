# Wiring only: the board and alert layers live in their own modules.
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
