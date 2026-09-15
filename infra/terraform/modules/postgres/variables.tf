variable "identifier" {
  description = "RDS cluster identifier (lowercase, hyphen-separated)."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.identifier))
    error_message = "identifier must start with a letter, lowercase alphanum + hyphen, max 63 chars."
  }
}

variable "engine" {
  description = "RDS engine. aurora-postgresql for cluster shape."
  type        = string
  validation {
    condition     = contains(["aurora-postgresql", "postgres", "aurora-mysql"], var.engine)
    error_message = "engine must be aurora-postgresql, postgres, or aurora-mysql."
  }
}

variable "engine_version" {
  description = "Pinned engine version (never data-source; Floci cannot discover)."
  type        = string
  validation {
    condition     = length(var.engine_version) > 0 && can(regex("^[0-9]+\\.[0-9]+", var.engine_version))
    error_message = "engine_version must be pinned numeric (e.g. 16.6)."
  }
}

variable "database_name" {
  description = "Initial database name. Must match app POSTGRES_DB."
  type        = string
  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.database_name))
    error_message = "database_name must start with a letter, letters/numbers/underscores."
  }
}

variable "master_username" {
  description = "Master username (break-glass). App should use DATABASE_URL from secrets."
  type        = string
  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,15}$", var.master_username)) && var.master_username != "admin"
    error_message = "master_username must start with a letter, max 16 chars, not 'admin'."
  }
}

variable "db_sslmode" {
  description = "SSL mode for composed DATABASE_URLs. disable for emulator, require for real AWS."
  type        = string
  validation {
    condition     = contains(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"], var.db_sslmode)
    error_message = "db_sslmode must be disable, allow, prefer, require, verify-ca, or verify-full."
  }
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window days. 0 for emulator/dev, 7-30 for prod."
  type        = number
  validation {
    condition     = var.secret_recovery_window == 0 || (var.secret_recovery_window >= 7 && var.secret_recovery_window <= 30)
    error_message = "secret_recovery_window must be 0 or 7-30."
  }
}

variable "instance_class" {
  description = "RDS cluster instance class. Used for writer/reader instances."
  type        = string
  default     = "db.r5.large"
  validation {
    condition     = can(regex("^db\\.", var.instance_class))
    error_message = "instance_class must start with db. (e.g. db.r5.large)."
  }
}

variable "instance_count" {
  description = "Number of cluster instances. 1 for emulator/dev, 2 for prod HA (writer + reader)."
  type        = number
  default     = 1
  validation {
    condition     = var.instance_count >= 1 && var.instance_count <= 16
    error_message = "instance_count must be 1-16."
  }
}

variable "backup_retention_period" {
  description = "Backup retention days. 1 for emulator, 7 for prod."
  type        = number
  default     = 1
  validation {
    condition     = var.backup_retention_period >= 1 && var.backup_retention_period <= 35
    error_message = "backup_retention_period must be 1-35."
  }
}

variable "storage_encrypted" {
  description = "Enable storage encryption. false for emulator, true for prod."
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Enable deletion protection. false for emulator/dev, true for prod."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Extra tags to merge into cluster/instance/secrets."
  type        = map(string)
  default     = {}
}
