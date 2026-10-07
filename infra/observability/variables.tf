variable "newrelic_account_id" {
  description = "New Relic account ID. Prefer NEW_RELIC_ACCOUNT_ID env; this var is the explicit fallback."
  type        = number
  default     = 6428768

  validation {
    condition     = var.newrelic_account_id > 0
    error_message = "newrelic_account_id must be a positive account ID."
  }
}

variable "newrelic_api_key" {
  description = "New Relic User API key (NRAK-...). Set via TF_VAR_newrelic_api_key or NEW_RELIC_API_KEY env. Never commit."
  type        = string
  sensitive   = true
  default     = null
}

variable "newrelic_region" {
  description = "New Relic data center region. EU for this project (one.eu.newrelic.com)."
  type        = string
  default     = "EU"

  validation {
    condition     = contains(["US", "EU", "JP"], var.newrelic_region)
    error_message = "newrelic_region must be US, EU, or JP."
  }
}

variable "environment" {
  description = "Deployment environment label baked into every NRQL filter (OTEL deployment.environment)."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "floci"], var.environment)
    error_message = "environment must be prod or floci."
  }
}

variable "alert_email" {
  description = "Email destination for all alert workflows. No Slack/PagerDuty in v1."
  type        = string
  default     = "kpisolkar24@gmail.com"

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.alert_email))
    error_message = "alert_email must be a valid email address."
  }
}

variable "service_version" {
  description = "Default service.version stamped on dashboards. Per-service OTEL_SERVICE_VERSION env wins at runtime."
  type        = string
  default     = "0.1.0"
}
