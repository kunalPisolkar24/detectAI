output "queue_urls" {
  description = "Queue URL by declared key; rides the runtime endpoints via QUEUE_URL env."
  value       = try(module.queues[0].queue_urls, {})
}

output "queue_arns" {
  description = "Queue ARN by declared key."
  value       = try(module.queues[0].queue_arns, {})
}

output "cache_addresses" {
  description = "Cache host:port by declared cluster name."
  value       = try(module.elasticache[0].addresses, {})
}

output "cache_endpoint_urls" {
  description = "rediss:// endpoints with the AUTH token; sensitive, for the service config plane."
  sensitive   = true
  value       = try(module.elasticache[0].endpoint_urls, {})
}

output "cache_fabric" {
  description = "Planned cache shape by declared cluster name."
  value       = try(module.elasticache[0].fabric, {})
}
