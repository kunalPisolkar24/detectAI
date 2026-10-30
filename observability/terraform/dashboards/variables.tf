variable "account_id" {
  description = "New Relic account every board belongs to."
  type        = number
}

variable "environment" {
  description = "Workspace data label the prod boards filter on. Dev twins hardcode dev in their JSON."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "floci"], var.environment)
    error_message = "environment must be prod or floci."
  }
}
