output "dashboards" {
  description = "Published dashboards by key: id, guid, permalink and the rendered json."
  value       = module.dashboards.boards
}

output "alerts" {
  description = "Alert policies by area: id and name."
  value       = module.alerts.policies
}
