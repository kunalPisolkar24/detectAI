output "writer_host" {
  description = "Postgres writer endpoint."
  value       = module.postgres.writer_host
}

output "reader_host" {
  description = "Postgres reader endpoint."
  value       = module.postgres.reader_host
}

output "port" {
  description = "Postgres port."
  value       = module.postgres.port
}

output "urls_secret_arn" {
  description = "ARN of Postgres URL secret (detectai/pg/urls)."
  value       = module.postgres.urls_secret_arn
}

output "database_url" {
  description = "DATABASE_URL (writer) — sensitive."
  value       = module.postgres.database_url
  sensitive   = true
}

output "database_url_replica" {
  description = "DATABASE_URL_REPLICA (reader) — sensitive."
  value       = module.postgres.database_url_replica
  sensitive   = true
}

output "docdb_endpoint" {
  description = "DocumentDB endpoint."
  value       = module.docdb.endpoint
}

output "docdb_port" {
  description = "DocumentDB port (dynamic on emulator)."
  value       = module.docdb.port
}

output "docdb_mongo_uri" {
  description = "MONGO_URI — sensitive."
  value       = module.docdb.mongo_uri
  sensitive   = true
}

output "docdb_mongo_database" {
  description = "MONGO_DATABASE name."
  value       = module.docdb.mongo_database
}

output "docdb_mongo_mode" {
  description = "MONGO_MODE (standalone or sharded)."
  value       = module.docdb.mongo_mode
}

output "docdb_urls_secret_arn" {
  description = "ARN of DocumentDB URL secret."
  value       = module.docdb.urls_secret_arn
}

output "redis_chat_primary_address" {
  description = "Redis chat primary address."
  value       = module.redis_chat.primary_endpoint_address
}

output "redis_chat_port" {
  description = "Redis chat port."
  value       = module.redis_chat.port
}

output "redis_chat_redis_url" {
  description = "REDIS_URL for chat — sensitive."
  value       = module.redis_chat.redis_url
  sensitive   = true
}

output "redis_chat_addrs" {
  description = "CHAT_REDIS_ADDR host:port."
  value       = module.redis_chat.redis_addrs_primary
}

output "redis_chat_urls_secret_arn" {
  description = "ARN of chat Redis URL secret."
  value       = module.redis_chat.urls_secret_arn
}

output "redis_events_primary_address" {
  description = "Redis events primary address."
  value       = module.redis_events.primary_endpoint_address
}

output "redis_events_port" {
  description = "Redis events port."
  value       = module.redis_events.port
}

output "redis_events_redis_url" {
  description = "EVENT_REDIS_URL — sensitive."
  value       = module.redis_events.redis_url
  sensitive   = true
}

output "redis_events_addrs" {
  description = "Events redis host:port."
  value       = module.redis_events.redis_addrs_primary
}

output "redis_events_urls_secret_arn" {
  description = "ARN of events Redis URL secret."
  value       = module.redis_events.urls_secret_arn
}

output "redis_users_primary_address" {
  description = "Redis users primary address."
  value       = module.redis_users.primary_endpoint_address
}

output "redis_users_port" {
  description = "Redis users port."
  value       = module.redis_users.port
}

output "redis_users_redis_url" {
  description = "REDIS_URL for users — sensitive."
  value       = module.redis_users.redis_url
  sensitive   = true
}

output "redis_users_addrs" {
  description = "Users redis host:port."
  value       = module.redis_users.redis_addrs_primary
}

output "redis_users_urls_secret_arn" {
  description = "ARN of users Redis URL secret."
  value       = module.redis_users.urls_secret_arn
}

output "mq_broker_id" {
  description = "MQ broker ID."
  value       = module.mq.broker_id
}

output "mq_broker_arn" {
  description = "MQ broker ARN."
  value       = module.mq.broker_arn
}

output "mq_amqp_endpoint" {
  description = "Raw AMQP endpoint."
  value       = module.mq.amqp_endpoint
}

output "mq_console_url" {
  description = "MQ console URL."
  value       = module.mq.console_url
}

output "mq_amqp_url" {
  description = "RABBITMQ_URL — sensitive."
  value       = module.mq.amqp_url
  sensitive   = true
}

output "mq_urls_secret_arn" {
  description = "ARN of MQ URL secret."
  value       = module.mq.urls_secret_arn
}
