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
