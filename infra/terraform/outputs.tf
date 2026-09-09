output "writer_host" {
  value = module.postgres.writer_host
}

output "reader_host" {
  value = module.postgres.reader_host
}

output "port" {
  value = module.postgres.port
}

output "urls_secret_arn" {
  value = module.postgres.urls_secret_arn
}

output "database_url" {
  value     = module.postgres.database_url
  sensitive = true
}

output "database_url_replica" {
  value     = module.postgres.database_url_replica
  sensitive = true
}
