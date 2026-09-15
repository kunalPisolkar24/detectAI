output "cluster_id" {
  description = "DocumentDB cluster identifier."
  value       = aws_docdb_cluster.this.cluster_identifier
}

output "cluster_arn" {
  description = "DocumentDB cluster ARN."
  value       = aws_docdb_cluster.this.arn
}

output "endpoint" {
  description = "DocumentDB cluster endpoint (host part of MONGO_URI). For emulator, read Port too — it is dynamic."
  value       = aws_docdb_cluster.this.endpoint
}

output "port" {
  description = "DocumentDB cluster port."
  value       = aws_docdb_cluster.this.port
}

output "master_secret_arn" {
  description = "ARN of master secret."
  value       = aws_secretsmanager_secret.master.arn
}

output "urls_secret_arn" {
  description = "ARN of URL secret."
  value       = aws_secretsmanager_secret.urls.arn
}

output "mongo_uri" {
  description = "Composed MONGO_URI with tls + retryWrites=false. Sensitive."
  value       = local.mongo_uri
  sensitive   = true
}

output "mongo_database" {
  description = "MONGO_DATABASE name."
  value       = var.database_name
}

output "mongo_mode" {
  description = "MONGO_MODE the app should use: standalone or sharded."
  value       = local.mongo_mode
}

output "mode" {
  description = "Requested docdb_mode (standalone vs elastic)."
  value       = var.mode
}
