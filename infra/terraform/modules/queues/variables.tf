variable "queues" {
  description = "The declarative queue ledger, passed straight from tfctl's infra.toml map."
  type = map(object({
    name              = string
    dlq               = string
    max_receive_count = optional(number, 0)
  }))

  validation {
    condition     = length(distinct([for queue in var.queues : queue.name])) == length(var.queues)
    error_message = "every queue name is unique (the name is the identity)."
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
