output "cluster_id" {
  value = aws_rds_cluster.this.cluster_identifier
}

output "cluster_arn" {
  value = aws_rds_cluster.this.arn
}

output "writer_host" {
  value = aws_rds_cluster.this.endpoint
}

output "reader_host" {
  value = aws_rds_cluster.this.reader_endpoint
}

output "port" {
  value = aws_rds_cluster.this.port
}

output "master_secret_arn" {
  value = aws_secretsmanager_secret.master.arn
}

output "urls_secret_arn" {
  value = aws_secretsmanager_secret.urls.arn
}

output "database_url" {
  value     = local.database_url
  sensitive = true
}

output "database_url_replica" {
  value     = local.database_url_replica
  sensitive = true
}
