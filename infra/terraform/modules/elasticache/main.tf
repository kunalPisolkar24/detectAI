locals {
  default_parameter_groups = {
    "7.0"   = "default.redis7"
    "6.2"   = "default.redis6.x"
    "6.0"   = "default.redis6.x"
    "5.0.6" = "default.redis5.0"
  }
}

resource "aws_elasticache_subnet_group" "this" {
  for_each = var.clusters

  name        = "${each.value.name}-subnet-group"
  description = "Subnet group for the ${each.value.name} cache cluster"
  subnet_ids  = var.subnet_ids
}

# A replication group is the only ElastiCache resource that supports an AUTH
# token in provider 5.x. With one node, cluster mode and failover off, it is a
# single Redis instance — the shared, disposable cache the spec describes.
resource "aws_elasticache_replication_group" "this" {
  for_each = var.clusters

  replication_group_id = each.value.name
  description          = "Shared ${each.value.name} cache"
  engine               = each.value.engine
  engine_version       = each.value.engine_version
  node_type            = each.value.node_type
  num_cache_clusters   = each.value.num_cache_nodes
  parameter_group_name = each.value.parameter_group_name != "" ? each.value.parameter_group_name : try(local.default_parameter_groups[each.value.engine_version], "default.redis7")
  port                 = each.value.port
  subnet_group_name    = aws_elasticache_subnet_group.this[each.key].name
  security_group_ids   = var.security_group_ids

  cluster_mode               = "disabled"
  automatic_failover_enabled = false
  multi_az_enabled           = false

  transit_encryption_enabled = true
  auth_token                 = var.auth_token
  auth_token_update_strategy = "SET"
}
