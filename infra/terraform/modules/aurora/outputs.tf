output "endpoints" {
  description = "Writer endpoint by declared cluster name."
  value       = { for key, cluster in aws_rds_cluster.this : key => cluster.endpoint }
}

output "reader_endpoints" {
  description = "Cluster reader endpoint by declared cluster name."
  value       = { for key, cluster in aws_rds_cluster.this : key => cluster.reader_endpoint }
}

output "ports" {
  description = "Listening port by declared cluster name."
  value       = { for key, cluster in aws_rds_cluster.this : key => cluster.port }
}

output "connection_urls" {
  description = "postgresql:// URLs with master credentials; sensitive, for the service config plane."
  sensitive   = true
  value = {
    for key, cluster in aws_rds_cluster.this :
    key => "postgresql://${var.master_username}:${var.master_password}@${cluster.endpoint}:${cluster.port}/${var.clusters[key].database_name}"
  }
}

output "instance_identifiers" {
  description = "Writer and reader instance identifiers by declared cluster name."
  value = {
    for key, cluster in var.clusters : key => sort([
      for identifier, instance in local.instances :
      identifier if instance.cluster_key == key
    ])
  }
}

output "fabric" {
  description = "Planned Aurora shape by declared cluster name."
  value = {
    for key, cluster in var.clusters : key => {
      engine                = cluster.engine
      engine_version        = cluster.engine_version
      database_name         = cluster.database_name
      port                  = cluster.port
      min_acu               = cluster.min_acu
      max_acu               = cluster.max_acu
      num_read_replicas     = cluster.num_read_replicas
      instance_count        = 1 + cluster.num_read_replicas
      instance_class        = "db.serverless"
      storage_encrypted     = cluster.storage_encrypted
      backup_retention_days = cluster.backup_retention_days
      deletion_protection   = cluster.deletion_protection
      skip_final_snapshot   = cluster.skip_final_snapshot
      subnet_group_name     = aws_db_subnet_group.this[key].name
      proxy_enabled         = false
    }
  }
}
