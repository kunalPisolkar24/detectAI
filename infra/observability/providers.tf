# New Relic provider only. No AWS provider here on purpose: this root must
# apply cleanly on Floci test runs without emulator endpoint hacks.
# Credentials come from env (NEW_RELIC_ACCOUNT_ID / NEW_RELIC_API_KEY /
# NEW_RELIC_REGION) or matching vars below; never commit keys.
provider "newrelic" {
  account_id = var.newrelic_account_id
  api_key    = var.newrelic_api_key
  region     = var.newrelic_region
}
