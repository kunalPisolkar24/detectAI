# ElastiCache Redis — cluster mode DISABLED (single shard) for XGroup/XReadGroup/Lua safety.
# Single responsibility: one replication group per purpose (chat/events/users) with consistent contract.
# - 1 primary + 1 replica + Multi-AZ + auto-failover = minimum HA for a queue (chat).
# - Single-node for cache/dedup (events/users) with DB fallback.
# - All traffic on primary endpoint; reader not used to avoid surprise routing.

resource "random_password" "auth" {
  length           = 32
  special          = true
  override_special = "-_!$"
}

resource "aws_secretsmanager_secret" "master" {
  name                    = "detectai/redis/${var.secret_prefix}/master"
  recovery_window_in_days = var.secret_recovery_window
  description             = "ElastiCache Redis ${var.secret_prefix} auth token"
  tags                    = var.tags
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

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.automatic_failover_enabled
  multi_az_enabled           = var.multi_az_enabled
  at_rest_encryption_enabled = var.at_rest_encryption_enabled
  transit_encryption_enabled = var.transit_encryption_enabled
  auth_token                 = random_password.auth.result

  snapshot_retention_limit = var.snapshot_retention_limit
  snapshot_window          = var.snapshot_window != "" ? var.snapshot_window : null

  tags = var.tags

  lifecycle {
    # Emulator allocates host-mapped ports (6379-6399) per group; logical port 6379 would otherwise force perpetual replacement.
    ignore_changes = [port]

    precondition {
      condition     = var.num_cache_clusters > 1 || var.automatic_failover_enabled == false
      error_message = "automatic_failover_enabled must be false when num_cache_clusters == 1 (single-node cache)."
    }
    precondition {
      condition     = var.multi_az_enabled == false || var.automatic_failover_enabled == true
      error_message = "multi_az_enabled requires automatic_failover_enabled == true."
    }
    precondition {
      condition     = var.num_cache_clusters > 1 || var.multi_az_enabled == false
      error_message = "multi_az_enabled requires num_cache_clusters > 1."
    }
  }
}

locals {
  # Emulator reports endpoint as localhost:port (proxy, 6379-6399). Real AWS reports DNS.
  # Floci deviation: populates configuration_endpoint_address even for cluster disabled, so coalesce.
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
  # urlencode auth token (may contain $) — consistent with docdb/postgres
  redis_url        = "${local.scheme}://:${urlencode(random_password.auth.result)}@${local.primary_address}:${local.primary_port}"
  redis_url_reader = "${local.scheme}://:${urlencode(random_password.auth.result)}@${local.reader_address}:${local.reader_port}"

  # go-redis style host:port without scheme
  redis_addrs_primary = "${local.primary_address}:${local.primary_port}"

  # Declarative secret payload map — replaces nested ternary. Each prefix has a stable contract.
  secret_payloads = {
    chat = {
      CHAT_REDIS_ADDR   = local.redis_addrs_primary
      REDIS_PASSWORD    = random_password.auth.result
      REDIS_URL         = local.redis_url
      REDIS_URL_READER  = local.redis_url_reader
      REDIS_TLS_ENABLED = tostring(local.tls_enabled)
    }
    events = {
      EVENT_REDIS_URL         = local.redis_url
      EVENT_REDIS_PASSWORD    = random_password.auth.result
      EVENT_REDIS_MODE        = "standalone"
      EVENT_REDIS_TLS_ENABLED = tostring(local.tls_enabled)
    }
    users = {
      REDIS_URL         = local.redis_url
      REDIS_PASSWORD    = random_password.auth.result
      REDIS_MODE        = "standalone"
      REDIS_TLS_ENABLED = tostring(local.tls_enabled)
    }
  }

  secret_payload = lookup(local.secret_payloads, var.secret_prefix, local.secret_payloads["chat"])
}

resource "aws_secretsmanager_secret" "urls" {
  name                    = "detectai/redis/${var.secret_prefix}/urls"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Composed ${var.secret_prefix} Redis URLs"
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "urls" {
  secret_id     = aws_secretsmanager_secret.urls.id
  secret_string = jsonencode(local.secret_payload)
}
