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
  description = "rediss:// endpoints for the service config plane; serverless enforces TLS in transit."
  value       = try(module.elasticache[0].endpoint_urls, {})
}

output "cache_fabric" {
  description = "Planned cache shape by declared cluster name."
  value       = try(module.elasticache[0].fabric, {})
}

output "atlas_connection_uris" {
  description = "mongodb+srv:// URIs for chats' MONGO_URI; sensitive, contains credentials."
  sensitive   = true
  value       = try(module.atlas[0].connection_uris, {})
}

output "atlas_standard_connection_uris" {
  description = "mongodb:// fallback URIs for networks without SRV resolution."
  sensitive   = true
  value       = try(module.atlas[0].standard_connection_uris, {})
}

output "atlas_fabric" {
  description = "Planned Atlas shape by declared cluster name."
  value       = try(module.atlas[0].fabric, {})
}

output "db_endpoints" {
  description = "Aurora writer endpoints by declared cluster name."
  value       = try(module.aurora[0].endpoints, {})
}

output "db_reader_endpoints" {
  description = "Aurora reader endpoints by declared cluster name."
  value       = try(module.aurora[0].reader_endpoints, {})
}

output "db_ports" {
  description = "Aurora ports by declared cluster name."
  value       = try(module.aurora[0].ports, {})
}

output "db_connection_urls" {
  description = "postgresql:// URLs with master credentials; sensitive, for the service config plane."
  sensitive   = true
  value       = try(module.aurora[0].connection_urls, {})
}

output "db_fabric" {
  description = "Planned Aurora shape by declared cluster name."
  value       = try(module.aurora[0].fabric, {})
}
