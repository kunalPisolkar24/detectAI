variable "clusters" {
  description = "The Aurora fabric declared by infra.toml, keyed by cluster name."
  type = map(object({
    name                  = string
    engine                = string
    engine_version        = string
    database_name         = string
    port                  = number
    min_acu               = number
    max_acu               = number
    num_read_replicas     = number
    storage_encrypted     = bool
    backup_retention_days = number
    deletion_protection   = bool
    skip_final_snapshot   = bool
  }))
}

variable "master_username" {
  description = "Aurora master username supplied by envs/.env through tfctl."
  type        = string
}

variable "master_password" {
  description = "Aurora master password; sensitive, supplied by envs/.env through tfctl."
  type        = string
  sensitive   = true
}

variable "subnet_ids" {
  description = "VPC subnet IDs for the cluster subnet groups; plane-specific, supplied by tfctl."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Optional VPC security group IDs attached to each cluster."
  type        = list(string)
  default     = []
}
