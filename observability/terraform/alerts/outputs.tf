output "policies" {
  description = "Alert policies by area: id and name."
  value = {
    for area, policy in newrelic_alert_policy.area : area => {
      id   = policy.id
      name = policy.name
    }
  }
}

output "workflow_name" {
  description = "Email workflow name."
  value       = newrelic_workflow.email_all.name
}
