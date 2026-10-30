variable "identifier" {
  description = "ElastiCache replication group identifier (used as replication_group_id)."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,39}$", var.identifier))
    error_message = "identifier must be lowercase letter + alphanum/hyphen, max 40 chars."
  }
}

variable "description" {
  description = "Description for replication group."
  type        = string
  default     = "Chat redis (streams + hot cache)"
}

variable "engine" {
  description = "Redis engine. Keep redis for dev/prod consistency (Floci default valkey overridden via image)."
  type        = string
  default     = "redis"
  validation {
    condition     = contains(["redis", "valkey"], var.engine)
    error_message = "engine must be redis or valkey."
  }
}

variable "engine_version" {
  description = "Redis engine version. Pinned, never data-sourced (Floci/LocalStack cannot discover)."
  type        = string
  default     = "7.1"
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.engine_version))
    error_message = "engine_version must be numeric (e.g. 7.1)."
  }
}

variable "node_type" {
  description = "ElastiCache node type. cache.t3.micro for Floci/dev, cache.r6g.large for prod."
  type        = string
  default     = "cache.t3.micro"
  validation {
    condition     = can(regex("^cache\\.", var.node_type))
    error_message = "node_type must start with cache. (e.g. cache.t3.micro)."
  }
}

variable "port" {
  description = "Redis port (6379). Emulator proxy will allocate 6379-6399, reported via PrimaryEndpoint."
  type        = number
  default     = 6379
  validation {
    condition     = var.port >= 1024 && var.port <= 65535
    error_message = "port must be 1024-65535."
  }
}

variable "parameter_group_name" {
  description = "Parameter group. Must match engine. default.redis7 for cluster disabled (noeviction for streams)."
  type        = string
  default     = "default.redis7"
}

variable "num_cache_clusters" {
  description = "Number of clusters (primary + replicas). 2 = 1 primary + 1 replica (primary-for-all, min HA)."
  type        = number
  default     = 2
  validation {
    condition     = var.num_cache_clusters >= 1 && var.num_cache_clusters <= 6
    error_message = "num_cache_clusters must be 1-6."
  }
}

variable "automatic_failover_enabled" {
  description = "Enable automatic failover. Must be true when num_cache_clusters >1 and multi_az true."
  type        = bool
  default     = true
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ. Requires automatic_failover and >=1 replica."
  type        = bool
  default     = true
}

variable "at_rest_encryption_enabled" {
  description = "At-rest encryption. false for Floci/LocalStack, true for prod."
  type        = bool
  default     = false
}

variable "transit_encryption_enabled" {
  description = "Transit encryption (TLS). false for Floci/LocalStack, true for prod (rediss://)."
  type        = bool
  default     = false
}

variable "snapshot_retention_limit" {
  description = "Snapshot retention days. 0 for Floci/dev, 7 for prod (streams durability)."
  type        = number
  default     = 0
  validation {
    condition     = var.snapshot_retention_limit >= 0 && var.snapshot_retention_limit <= 35
    error_message = "snapshot_retention_limit must be 0-35."
  }
}

variable "snapshot_window" {
  description = "Snapshot window. Empty for Floci/LocalStack."
  type        = string
  default     = ""
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

variable "secret_prefix" {
  description = "Secrets prefix for this purpose. chat -> detectai/redis/chat, events -> detectai/redis/events"
  type        = string
  default     = "chat"
  validation {
    condition     = contains(["chat", "events", "users"], var.secret_prefix)
    error_message = "secret_prefix must be chat, events, or users."
  }
}

variable "tags" {
  description = "Extra tags for replication group and secrets."
  type        = map(string)
  default     = {}
}
