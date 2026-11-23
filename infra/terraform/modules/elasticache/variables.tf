variable "clusters" {
  description = "The cache clusters declared by infra.toml, keyed by name."
  type = map(object({
    name                 = string
    engine               = string
    major_engine_version = string
    max_data_storage_gb  = number
    max_ecpu_per_second  = number
  }))
}

variable "subnet_ids" {
  description = "VPC subnet IDs for the serverless cache VPC endpoints; plane-specific, supplied by tfctl."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Optional VPC security group IDs attached to each cache."
  type        = list(string)
  default     = []
}
