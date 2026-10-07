output "dashboard_guids" {
  description = "New Relic dashboard GUIDs by key."
  value = {
    for k, d in newrelic_one_dashboard_json.dashboards : k => d.guid
  }
}

output "dashboard_urls" {
  description = "New Relic dashboard permalinks by key."
  value = {
    for k, d in newrelic_one_dashboard_json.dashboards : k => d.permalink
  }
}

output "environment" {
  description = "Environment label baked into dashboard NRQL."
  value       = var.environment
}
