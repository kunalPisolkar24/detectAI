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
