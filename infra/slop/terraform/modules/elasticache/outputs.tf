output "replication_group_id" {
  description = "Replication group ID."
  value       = aws_elasticache_replication_group.this.replication_group_id
}

output "primary_endpoint_address" {
  description = "Primary endpoint address (emulator: localhost; AWS: DNS)."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "primary_endpoint_port" {
  description = "Primary endpoint port."
  value       = aws_elasticache_replication_group.this.port
}

output "reader_endpoint_address" {
  description = "Reader endpoint address (falls back to primary)."
  value       = try(aws_elasticache_replication_group.this.reader_endpoint_address, aws_elasticache_replication_group.this.primary_endpoint_address)
}

output "port" {
  description = "Replication group port."
  value       = aws_elasticache_replication_group.this.port
}

output "engine" {
  description = "Engine."
  value       = var.engine
}

output "engine_version" {
  description = "Engine version."
  value       = var.engine_version
}

output "auth_token" {
  description = "Auth token for Redis."
  value       = random_password.auth.result
  sensitive   = true
}

output "redis_url" {
  description = "redis:// or rediss:// URL for primary (with encoded auth token)."
  value       = local.redis_url
  sensitive   = true
}

output "redis_addrs_primary" {
  description = "host:port for CHAT_REDIS_ADDR (go-redis *redis.Client, single primary)."
  value       = local.redis_addrs_primary
}

output "master_secret_arn" {
  description = "ARN of master secret."
  value       = aws_secretsmanager_secret.master.arn
}

output "urls_secret_arn" {
  description = "ARN of composed URL secret."
  value       = aws_secretsmanager_secret.urls.arn
}

output "redis_addr" {
  description = "host:port for CHAT_REDIS_ADDR (alias of redis_addrs_primary)."
  value       = local.redis_addrs_primary
}
