# New Relic only: no AWS provider — this root must apply cleanly on the
# Floci plane, whose AWS endpoints only exist behind the emulator.
provider "newrelic" {
  account_id = var.newrelic_account_id
  api_key    = var.newrelic_api_key
  region     = var.newrelic_region
}
