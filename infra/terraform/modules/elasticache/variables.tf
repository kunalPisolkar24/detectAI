variable "clusters" {
  description = "The cache clusters declared by infra.toml, keyed by name."
  type = map(object({
    name                 = string
    engine               = string
    engine_version       = string
    node_type            = string
    num_cache_nodes      = number
    port                 = number
    parameter_group_name = string
  }))
}

variable "auth_token" {
  description = "AUTH token supplied by envs/.env through tfctl."
  type        = string
  default     = ""
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
