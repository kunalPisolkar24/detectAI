# ElastiCache Redis for chat streams + hot cache (primary-for-all).
# Cluster mode DISABLED (single shard) to keep XGroup/XReadGroup/XAutoClaim/Lua single-shard safe.
# 1 primary + 1 replica + Multi-AZ + auto-failover = minimum HA for a queue.
# All traffic on primary endpoint (reader endpoint not used) avoids reader-points-to-primary surprise.
# Engine pinned to redis 7.x to keep dev (redis:7-alpine) and prod consistent; Floci default valkey overridden via image env.

resource "random_password" "auth" {
  length           = 32
  special          = true
  override_special = "-_!$"
}

resource "aws_secretsmanager_secret" "master" {
  name                    = "detectai/redis/chat/master"
  recovery_window_in_days = var.secret_recovery_window
  description             = "ElastiCache Redis chat auth token (primary-for-all)"
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({
    auth_token = random_password.auth.result
    username   = "default"
  })
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = var.identifier
  description          = var.description

  engine               = var.engine
  engine_version       = var.engine_version
  node_type            = var.node_type
  port                 = var.port
  parameter_group_name = var.parameter_group_name

  num_cache_clusters           = var.num_cache_clusters
  automatic_failover_enabled   = var.automatic_failover_enabled
  multi_az_enabled             = var.multi_az_enabled
  at_rest_encryption_enabled   = var.at_rest_encryption_enabled
  transit_encryption_enabled   = var.transit_encryption_enabled
  auth_token                   = random_password.auth.result

  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = var.snapshot_window != "" ? var.snapshot_window : null

  # Floci stores but does not enforce: subnet group, security groups, etc.
}

locals {
  # Floci reports endpoint as localhost:port (proxy inside Floci container, 6379-6399).
  # Real AWS reports primary_endpoint_address/reader. For host access via bridge IP,
  # Go tests replace localhost with 172.17.0.2 (Floci bridge IP) when FLoci is used.
  # Floci currently populates configuration_endpoint_address even for cluster disabled (deviation), so coalesce.
  primary_address = coalesce(
    try(aws_elasticache_replication_group.this.primary_endpoint_address, null),
    try(aws_elasticache_replication_group.this.configuration_endpoint_address, null),
    "localhost"
  )
  primary_port = coalesce(try(aws_elasticache_replication_group.this.port, null), 6379)
  reader_address = coalesce(
    try(aws_elasticache_replication_group.this.reader_endpoint_address, null),
    local.primary_address
  )
  reader_port = coalesce(try(aws_elasticache_replication_group.this.port, null), local.primary_port)

  tls_enabled = var.transit_encryption_enabled
  scheme      = local.tls_enabled ? "rediss" : "redis"
  # urlencode auth token (may contain $) like docdb fix 861c916; reader not used but kept for completeness
  redis_url         = "${local.scheme}://:${urlencode(random_password.auth.result)}@${local.primary_address}:${local.primary_port}"
  redis_url_reader  = "${local.scheme}://:${urlencode(random_password.auth.result)}@${local.reader_address}:${local.reader_port}"

  # CHAT_REDIS_ADDRS for chats UniversalClient is host:port without scheme (go-redis style)
  redis_addrs_primary = "${local.primary_address}:${local.primary_port}"
}

resource "aws_secretsmanager_secret" "urls" {
  name                    = "detectai/redis/chat/urls"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Composed chat Redis URLs (primary-for-all, streams+cache)"
}

resource "aws_secretsmanager_secret_version" "urls" {
  secret_id = aws_secretsmanager_secret.urls.id
  secret_string = jsonencode({
    CHAT_REDIS_ADDRS = local.redis_addrs_primary
    REDIS_PASSWORD   = random_password.auth.result
    CHAT_REDIS_MODE  = "standalone"
    REDIS_URL        = local.redis_url
    REDIS_URL_READER = local.redis_url_reader
    REDIS_TLS_ENABLED = tostring(local.tls_enabled)
  })
}
