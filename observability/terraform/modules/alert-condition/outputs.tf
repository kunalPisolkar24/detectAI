output "id" {
  description = "Condition ID, referenced when a caller needs to chain it."
  value       = newrelic_nrql_alert_condition.condition.id
}

output "name" {
  description = "Condition name as rendered in New Relic."
  value       = newrelic_nrql_alert_condition.condition.name
}
