variable "floci_endpoint" {
  description = "Floci base URL. All AWS API calls go here. Empty string = real AWS."
  type        = string
  default     = ""
}

variable "aws_region" {
  description = "AWS region (Floci accepts any value)."
  type        = string
  default     = "ap-south-1"
}

variable "cluster_identifier" {
  description = "RDS cluster identifier."
  type        = string
  default     = "detectai-pg-floci"
}

variable "engine" {
  description = "RDS engine. aurora-postgresql for cluster shape."
  type        = string
  default     = "aurora-postgresql"
}

variable "engine_version" {
  description = "Pinned engine version (Floci cannot discover versions, so never data-source this)."
  type        = string
  default     = "16.6"
}

variable "database_name" {
  description = "Initial database name. Must match app POSTGRES_DB."
  type        = string
  default     = "detect_ai"
}

variable "master_username" {
  description = "Master username. v1 uses this user for app URLs too; dedicated app user comes later."
  type        = string
  default     = "dbadmin"
}

variable "db_sslmode" {
  description = "SSL mode for composed DATABASE_URLs. disable for Floci, require for real AWS."
  type        = string
  default     = "disable"
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window. 0 for Floci/dev destroy/apply cycles, 30 for prod safety."
  type        = number
  default     = 0
}

variable "docdb_cluster_identifier" {
  description = "DocumentDB cluster identifier for chats."
  type        = string
  default     = "detectai-docdb-floci"
}

variable "docdb_engine_version" {
  description = "DocumentDB engine version. Floci accepts 3.6.0, 4.0.0, 5.0.0, 5.0.1, 8.0.0, 8.0.1."
  type        = string
  default     = "5.0.0"
}

variable "docdb_database_name" {
  description = "DocumentDB initial database. Must match chats MONGO_DATABASE."
  type        = string
  default     = "chat_db"
}

variable "docdb_master_username" {
  description = "DocumentDB master username."
  type        = string
  default     = "docdbadmin"
}

variable "docdb_instance_class" {
  description = "DocumentDB instance class. Floci accepts any."
  type        = string
  default     = "db.r5.large"
}

variable "docdb_tls_enabled" {
  description = "TLS for DocumentDB connections. false for Floci, true for real AWS."
  type        = bool
  default     = false
}

variable "docdb_mode" {
  description = "DocumentDB mode: standalone (Floci, single mongo container) or elastic (real AWS sharded). App derives MONGO_MODE from this."
  type        = string
  default     = "standalone"
}

variable "redis_chat_identifier" {
  description = "ElastiCache replication group identifier for chat streams+cache (primary-for-all)."
  type        = string
  default     = "detectai-redis-chat-floci"
}

variable "redis_chat_engine_version" {
  description = "Redis engine version. Pinned 7.1 for dev/prod consistency (Floci default valkey overridden)."
  type        = string
  default     = "7.1"
}

variable "redis_chat_node_type" {
  description = "ElastiCache node type. cache.t3.micro for Floci/dev, cache.r6g.large for prod."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_chat_transit_encryption_enabled" {
  description = "Transit encryption (TLS). false for Floci, true for prod (rediss://)."
  type        = bool
  default     = false
}

variable "redis_chat_at_rest_encryption_enabled" {
  description = "At-rest encryption. false for Floci, true for prod."
  type        = bool
  default     = false
}

variable "redis_chat_snapshot_retention_limit" {
  description = "Snapshot retention days. 0 for Floci/dev, 7 for prod (streams durability)."
  type        = number
  default     = 0
}

variable "redis_events_identifier" {
  description = "ElastiCache replication group identifier for Paddle dedup (single-node, no replica)."
  type        = string
  default     = "detectai-redis-events-floci"
}

variable "redis_events_engine_version" {
  description = "Redis engine version for events. Pinned 7.1."
  type        = string
  default     = "7.1"
}

variable "redis_events_node_type" {
  description = "Node type for events. cache.t3.micro Floci/dev (tiny), cache.t4g.small prod."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_events_transit_encryption_enabled" {
  description = "Transit encryption for events. false Floci, true prod."
  type        = bool
  default     = false
}

variable "redis_events_at_rest_encryption_enabled" {
  description = "At-rest encryption for events. false Floci, true prod."
  type        = bool
  default     = false
}

variable "redis_events_snapshot_retention_limit" {
  description = "Snapshot retention for events. 0 Floci, 1 prod (AOF + daily RDB)."
  type        = number
  default     = 0
}

variable "redis_users_identifier" {
  description = "ElastiCache replication group identifier for users cache+rate-limit (single-node)."
  type        = string
  default     = "detectai-redis-users-floci"
}

variable "redis_users_engine_version" {
  description = "Redis engine version for users. Pinned 7.1."
  type        = string
  default     = "7.1"
}

variable "redis_users_node_type" {
  description = "Node type for users. cache.t3.micro Floci/dev, cache.t4g.small prod."
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_users_transit_encryption_enabled" {
  description = "Transit encryption for users. false Floci, true prod."
  type        = bool
  default     = false
}

variable "redis_users_at_rest_encryption_enabled" {
  description = "At-rest encryption for users. false Floci, true prod."
  type        = bool
  default     = false
}

variable "redis_users_snapshot_retention_limit" {
  description = "Snapshot retention for users. 0 Floci, 1 prod (volatile-ttl AOF)."
  type        = number
  default     = 0
}
