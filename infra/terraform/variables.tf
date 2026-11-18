variable "aws_region" {
  description = "AWS region for the queue fabric (the emulator accepts any value)."
  type        = string
  default     = "ap-southeast-2"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region code (e.g. ap-southeast-2)."
  }
}

variable "emulator_endpoint" {
  description = "Emulator endpoint (Floci or LocalStack, e.g. http://localhost:4566). Null or empty = real AWS."
  type        = string
  default     = null

  validation {
    condition = var.emulator_endpoint == null || var.emulator_endpoint == "" || can(
      regex("^https?://", var.emulator_endpoint)
    )
    error_message = "emulator_endpoint must be null, empty, or a valid http(s) URL (e.g. http://localhost:4566)."
  }
}

variable "queues" {
  description = "The queue fabric, declared by infra.toml: every queue the stack owns plus optional redrive targets."
  type = map(object({
    name              = string
    dlq               = string
    max_receive_count = optional(number, 0)
  }))
  default = {}

  validation {
    condition = alltrue(
      [for queue in var.queues : can(regex("^[A-Za-z0-9_-]{1,75}\\.fifo$", queue.name))]
    )
    error_message = "every queue name must be a FIFO name per AWS: [A-Za-z0-9_-]{1,75} ending in '.fifo'."
  }
}

variable "cache_clusters" {
  description = "The ElastiCache fabric declared by infra.toml; empty means no cache."
  type = map(object({
    name                 = string
    engine               = string
    engine_version       = string
    node_type            = string
    num_cache_nodes      = number
    port                 = number
    parameter_group_name = string
  }))
  default = {}

  validation {
    condition     = alltrue([for cluster in var.cache_clusters : cluster.engine == "redis"])
    error_message = "every cache engine must be redis (the shared cache contract)."
  }

  validation {
    condition     = alltrue([for cluster in var.cache_clusters : can(regex("^[a-z][a-z0-9-]{0,39}$", cluster.name))])
    error_message = "every cache name must be a lowercase DNS-style name: [a-z][a-z0-9-]{0,39}."
  }

  validation {
    condition     = alltrue([for cluster in var.cache_clusters : cluster.num_cache_nodes >= 1 && cluster.num_cache_nodes <= 6])
    error_message = "num_cache_nodes must be 1-6."
  }

  validation {
    condition     = alltrue([for cluster in var.cache_clusters : cluster.port >= 1 && cluster.port <= 65535])
    error_message = "cache port must be 1-65535."
  }
}

variable "cache_auth_token" {
  description = "AUTH token for the cache fabric; sensitive, supplied by envs/.env via tfctl."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cache_subnet_ids" {
  description = "VPC subnet IDs for the cache subnet groups; plane-specific, supplied by tfctl."
  type        = list(string)
  default     = []
}

variable "cache_security_group_ids" {
  description = "Optional VPC security group IDs for the cache clusters."
  type        = list(string)
  default     = []
}

variable "atlas_clusters" {
  description = "The Atlas free-tier fabric declared by infra.toml; empty means no Atlas."
  type = map(object({
    name   = string
    region = string
    tier   = string
  }))
  default = {}

  validation {
    condition     = alltrue([for cluster in var.atlas_clusters : cluster.tier == "M0"])
    error_message = "the Atlas fabric is pinned to the M0 free tier."
  }

  validation {
    condition     = alltrue([for cluster in var.atlas_clusters : can(regex("^[A-Z]{2}_[A-Z]+_[0-9]+$", cluster.region))])
    error_message = "Atlas regions use names like AP_SOUTHEAST_2, not AWS codes."
  }
}

variable "atlas_public_key" {
  description = "Atlas programmatic API public key; sensitive, supplied by envs/.env via tfctl."
  type        = string
  # A placeholder keeps the provider quiet on runs that never configure it
  # (queue/cache-only and every floci run); tfctl enforces real keys on a
  # real plane when [[atlas]] is declared.
  default   = "unused"
  sensitive = true
}

variable "atlas_private_key" {
  description = "Atlas programmatic API private key; sensitive, supplied by envs/.env via tfctl."
  type        = string
  default     = "unused"
  sensitive   = true
}

variable "atlas_project_id" {
  description = "The 24-hex Atlas project ID that owns the free cluster."
  type        = string
  default     = ""

  validation {
    condition     = var.atlas_project_id == "" || can(regex("^[0-9a-fA-F]{24}$", var.atlas_project_id))
    error_message = "atlas_project_id must be a 24-character hex string."
  }
}

variable "atlas_db_username" {
  description = "SCRAM database user created on the Atlas free cluster."
  type        = string
  default     = ""
}

variable "atlas_db_password" {
  description = "SCRAM database user password; sensitive, supplied by envs/.env via tfctl."
  type        = string
  default     = ""
  sensitive   = true
}

variable "atlas_ip_cidrs" {
  description = "Explicit cluster access-list CIDRs (IPv4 or IPv6); no open default."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for cidr in var.atlas_ip_cidrs : can(cidrhost(cidr, 0))])
    error_message = "every atlas_ip_cidrs entry must be a valid IPv4 or IPv6 CIDR."
  }
}

variable "visibility_timeout_seconds" {
  description = "The redrive budget per receive attempt, shared by the fabric."
  type        = number
  default     = 300

  validation {
    condition     = var.visibility_timeout_seconds >= 0 && var.visibility_timeout_seconds <= 43200
    error_message = "visibility_timeout_seconds must be 0-43200."
  }
}

variable "message_retention_seconds" {
  description = "Retention for every queue in the fabric; 1209600 is AWS's 14-day maximum."
  type        = number
  default     = 1209600

  validation {
    condition     = var.message_retention_seconds >= 60 && var.message_retention_seconds <= 1209600
    error_message = "message_retention_seconds must be 60-1209600 (14 days)."
  }
}
