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

output "docdb_endpoint" {
  value = module.docdb.endpoint
}

output "docdb_port" {
  value = module.docdb.port
}

output "docdb_mongo_uri" {
  value     = module.docdb.mongo_uri
  sensitive = true
}

output "docdb_mongo_database" {
  value = module.docdb.mongo_database
}

output "docdb_mongo_mode" {
  value = module.docdb.mongo_mode
}

output "docdb_urls_secret_arn" {
  value = module.docdb.urls_secret_arn
}
