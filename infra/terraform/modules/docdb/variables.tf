variable "identifier" {
  description = "DocumentDB cluster identifier."
  type        = string
}

variable "engine_version" {
  description = "DocumentDB engine version. Floci validates against 3.6.0, 4.0.0, 5.0.0, 5.0.1, 8.0.0, 8.0.1."
  type        = string
  default     = "5.0.0"
}

variable "database_name" {
  description = "Initial database name for MONGO_DATABASE. Must match app default."
  type        = string
  default     = "chat_db"
}

variable "master_username" {
  description = "DocumentDB master username."
  type        = string
  default     = "docdbadmin"
}

variable "instance_class" {
  description = "DocumentDB instance class. Floci accepts any string."
  type        = string
  default     = "db.r5.large"
}

variable "port" {
  description = "DocumentDB port. 27017 only for elastic; Floci returns mapped port regardless."
  type        = number
  default     = 27017
}

variable "tls_enabled" {
  description = "Whether apps should use TLS. false for Floci, true for real AWS."
  type        = bool
  default     = false
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window. 0 for Floci/dev, 30 for prod."
  type        = number
  default     = 0
}

variable "mode" {
  description = "DocumentDB mode: standalone (Floci-supported instance-based) or elastic (real AWS only, Floci mocks). Controls whether app sets MONGO_MODE=sharded."
  type        = string
  default     = "standalone"
  validation {
    condition     = contains(["standalone", "elastic"], var.mode)
    error_message = "mode must be 'standalone' or 'elastic'"
  }
}
