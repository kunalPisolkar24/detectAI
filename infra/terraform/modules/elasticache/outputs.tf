output "addresses" {
  description = "Primary endpoint host:port by declared cluster name."
  value = {
    for key, cluster in aws_elasticache_replication_group.this :
    key => try("${cluster.primary_endpoint_address}:${cluster.port}", "")
  }
}

output "endpoint_urls" {
  description = "rediss:// endpoints carrying the AUTH token, by declared cluster name."
  sensitive   = true
  value = {
    for key, cluster in aws_elasticache_replication_group.this :
    key => try("rediss://:${var.auth_token}@${cluster.primary_endpoint_address}:${cluster.port}", "")
  }
}

output "fabric" {
  description = "Planned cache shape by declared cluster name (the contract surface)."
  value = {
    for key, cluster in aws_elasticache_replication_group.this : key => {
      name                       = cluster.replication_group_id
      engine                     = cluster.engine
      engine_version             = cluster.engine_version
      node_type                  = cluster.node_type
      num_cache_nodes            = cluster.num_cache_clusters
      port                       = cluster.port
      parameter_group_name       = cluster.parameter_group_name
      subnet_group_name          = cluster.subnet_group_name
      cluster_mode               = cluster.cluster_mode
      automatic_failover_enabled = cluster.automatic_failover_enabled
      transit_encryption_enabled = cluster.transit_encryption_enabled
    }
  }
}
