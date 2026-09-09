output "replication_group_id" {
  value = aws_elasticache_replication_group.this.replication_group_id
}

output "primary_endpoint_address" {
  description = "Primary endpoint address (Floci: localhost or Floci IP; AWS: DNS). For Floci host access replace localhost with 172.17.0.2."
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "primary_endpoint_port" {
  value = aws_elasticache_replication_group.this.port
}

output "reader_endpoint_address" {
  value = try(aws_elasticache_replication_group.this.reader_endpoint_address, aws_elasticache_replication_group.this.primary_endpoint_address)
}

output "port" {
  value = aws_elasticache_replication_group.this.port
}

output "engine" {
  value = var.engine
}

output "engine_version" {
  value = var.engine_version
}

output "auth_token" {
  value     = random_password.auth.result
  sensitive = true
}

output "redis_url" {
  description = "redis:// or rediss:// URL for primary (with encoded auth token)"
  value       = local.redis_url
  sensitive   = true
}

output "redis_addrs_primary" {
  description = "host:port for CHAT_REDIS_ADDRS (go-redis UniversalClient)"
  value       = local.redis_addrs_primary
}

output "master_secret_arn" {
  value = aws_secretsmanager_secret.master.arn
}

output "urls_secret_arn" {
  value = aws_secretsmanager_secret.urls.arn
}

output "mode" {
  description = "CHAT_REDIS_MODE for chat service (always standalone for 1+1 replication group)"
  value       = "standalone"
}
