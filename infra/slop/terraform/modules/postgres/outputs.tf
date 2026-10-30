output "cluster_id" {
  description = "RDS cluster identifier."
  value       = aws_rds_cluster.this.cluster_identifier
}

output "cluster_arn" {
  description = "RDS cluster ARN."
  value       = aws_rds_cluster.this.arn
}

output "writer_host" {
  description = "Writer endpoint host."
  value       = aws_rds_cluster.this.endpoint
}

output "reader_host" {
  description = "Reader endpoint host."
  value       = aws_rds_cluster.this.reader_endpoint
}

output "port" {
  description = "RDS cluster port."
  value       = aws_rds_cluster.this.port
}

output "master_secret_arn" {
  description = "ARN of master credentials secret."
  value       = aws_secretsmanager_secret.master.arn
}

output "urls_secret_arn" {
  description = "ARN of composed URL secret (DATABASE_URL)."
  value       = aws_secretsmanager_secret.urls.arn
}

output "database_url" {
  description = "Composed DATABASE_URL (writer) with encoded password."
  value       = local.database_url
  sensitive   = true
}

output "database_url_replica" {
  description = "Composed DATABASE_URL_REPLICA (reader) with encoded password."
  value       = local.database_url_replica
  sensitive   = true
}
