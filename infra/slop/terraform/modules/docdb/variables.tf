variable "identifier" {
  description = "DocumentDB cluster identifier."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.identifier))
    error_message = "identifier must start with a letter, lowercase alphanum + hyphen, max 63 chars."
  }
}

variable "engine_version" {
  description = "DocumentDB engine version. Floci/LocalStack validate against 3.6.0, 4.0.0, 5.0.0, 5.0.1, 8.0.0, 8.0.1."
  type        = string
  default     = "5.0.0"
  validation {
    condition     = contains(["3.6.0", "4.0.0", "5.0.0", "5.0.1", "8.0.0", "8.0.1"], var.engine_version)
    error_message = "engine_version must be one of 3.6.0, 4.0.0, 5.0.0, 5.0.1, 8.0.0, 8.0.1."
  }
}

variable "database_name" {
  description = "Initial database name for MONGO_DATABASE. Must match app default."
  type        = string
  default     = "chat_db"
  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.database_name))
    error_message = "database_name must start with a letter, letters/numbers/underscores."
  }
}

variable "master_username" {
  description = "DocumentDB master username."
  type        = string
  default     = "docdbadmin"
  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,15}$", var.master_username))
    error_message = "master_username must start with a letter, max 16 chars."
  }
}

variable "instance_class" {
  description = "DocumentDB instance class. Emulator accepts any string."
  type        = string
  default     = "db.r5.large"
  validation {
    condition     = can(regex("^db\\.", var.instance_class))
    error_message = "instance_class must start with db. (e.g. db.r5.large)."
  }
}

variable "port" {
  description = "DocumentDB port. 27017 for elastic; emulator returns mapped port regardless."
  type        = number
  default     = 27017
  validation {
    condition     = var.port >= 1024 && var.port <= 65535
    error_message = "port must be 1024-65535."
  }
}

variable "tls_enabled" {
  description = "Whether apps should use TLS. false for Floci/LocalStack, true for real AWS."
  type        = bool
  default     = false
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window. 0 for Floci/dev, 30 for prod."
  type        = number
  default     = 0
  validation {
    condition     = var.secret_recovery_window == 0 || (var.secret_recovery_window >= 7 && var.secret_recovery_window <= 30)
    error_message = "secret_recovery_window must be 0 or 7-30."
  }
}

variable "mode" {
  description = "DocumentDB mode: standalone (Floci/LocalStack instance-based) or elastic (real AWS sharded). Controls MONGO_MODE."
  type        = string
  default     = "standalone"
  validation {
    condition     = contains(["standalone", "elastic"], var.mode)
    error_message = "mode must be 'standalone' or 'elastic'"
  }
}

variable "tags" {
  description = "Extra tags for cluster and secrets."
  type        = map(string)
  default     = {}
}
