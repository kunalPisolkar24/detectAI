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

output "redis_chat_primary_address" {
  value = module.redis_chat.primary_endpoint_address
}

output "redis_chat_port" {
  value = module.redis_chat.port
}

output "redis_chat_redis_url" {
  value     = module.redis_chat.redis_url
  sensitive = true
}

output "redis_chat_addrs" {
  value = module.redis_chat.redis_addrs_primary
}

output "redis_chat_urls_secret_arn" {
  value = module.redis_chat.urls_secret_arn
}

output "redis_events_primary_address" {
  value = module.redis_events.primary_endpoint_address
}

output "redis_events_port" {
  value = module.redis_events.port
}

output "redis_events_redis_url" {
  value     = module.redis_events.redis_url
  sensitive = true
}

output "redis_events_addrs" {
  value = module.redis_events.redis_addrs_primary
}

output "redis_events_urls_secret_arn" {
  value = module.redis_events.urls_secret_arn
}

output "redis_users_primary_address" {
  value = module.redis_users.primary_endpoint_address
}

output "redis_users_port" {
  value = module.redis_users.port
}

output "redis_users_redis_url" {
  value     = module.redis_users.redis_url
  sensitive = true
}

output "redis_users_addrs" {
  value = module.redis_users.redis_addrs_primary
}

output "redis_users_urls_secret_arn" {
  value = module.redis_users.urls_secret_arn
}
