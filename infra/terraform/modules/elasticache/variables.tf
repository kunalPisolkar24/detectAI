variable "identifier" {
  description = "ElastiCache replication group identifier (used as replication_group_id)."
  type        = string
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
}

variable "engine_version" {
  description = "Redis engine version. Pinned, never data-sourced (Floci cannot discover)."
  type        = string
  default     = "7.1"
}

variable "node_type" {
  description = "ElastiCache node type. cache.t3.micro for Floci/dev, cache.r6g.large for prod."
  type        = string
  default     = "cache.t3.micro"
}

variable "port" {
  description = "Redis port (6379). Floci proxy will allocate 6379-6399, reported via PrimaryEndpoint."
  type        = number
  default     = 6379
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
  description = "At-rest encryption. false for Floci, true for prod."
  type        = bool
  default     = false
}

variable "transit_encryption_enabled" {
  description = "Transit encryption (TLS). false for Floci, true for prod (rediss://)."
  type        = bool
  default     = false
}

variable "snapshot_retention_limit" {
  description = "Snapshot retention days. 0 for Floci/dev, 7 for prod (streams durability)."
  type        = number
  default     = 0
}

variable "snapshot_window" {
  description = "Snapshot window. Empty for Floci."
  type        = string
  default     = ""
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window. 0 for Floci/dev, 30 for prod."
  type        = number
  default     = 0
}
