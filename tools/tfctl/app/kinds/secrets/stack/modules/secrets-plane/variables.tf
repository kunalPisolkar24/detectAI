variable "service_slug" {
  description = "Service slug the plane belongs to; every derived name comes from it."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]+(-[a-z0-9]+)*$", var.service_slug))
    error_message = "service_slug must be lowercase digits/hyphens, e.g. document-parser."
  }
}

variable "secret_recovery_window" {
  description = "Recovery window: 0 for emulator/dev cycles (destroy and reseed freely), 7-30 prod safety."
  type        = number
  default     = 0

  validation {
    condition     = var.secret_recovery_window == 0 || (var.secret_recovery_window >= 7 && var.secret_recovery_window <= 30)
    error_message = "secret_recovery_window must be 0 (emulator/dev) or 7-30 (prod)."
  }
}

variable "blob" {
  description = "Secret blob seeded as one JSON version; keys and length floors live in the service's secrets.toml."
  type        = map(string)
  default     = {}
  sensitive   = true
}

variable "ssm_parameters" {
  description = "Non-secret runtime config seeded from .env; each key becomes /detectai/<slug>/<KEY>."
  type        = map(string)
  default     = {}
}

variable "ssm_description" {
  description = "Description stamped on every seeded SSM parameter."
  type        = string
  default     = "Runtime config seeded from .env."
}
