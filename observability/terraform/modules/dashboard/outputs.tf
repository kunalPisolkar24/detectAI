output "id" {
  description = "Dashboard resource ID."
  value       = newrelic_one_dashboard_json.board.id
}

output "guid" {
  description = "Dashboard entity GUID (what tags ride on)."
  value       = newrelic_one_dashboard_json.board.guid
}

output "permalink" {
  description = "Direct link to the board."
  value       = newrelic_one_dashboard_json.board.permalink
}

output "json" {
  description = "Rendered board JSON, pass-through for tests and diffing."
  value       = var.json
}
