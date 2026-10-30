variable "account_id" {
  description = "New Relic account every policy belongs to."
  type        = number
}

variable "environment" {
  description = "Workspace data label baked into every condition's NRQL filter. Rig runs are excluded by it."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "floci"], var.environment)
    error_message = "environment must be prod or floci."
  }
}

variable "alert_email" {
  description = "Email destination all policies fan out to."
  type        = string
}
