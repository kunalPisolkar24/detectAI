variable "account_id" {
  description = "New Relic account the condition belongs to."
  type        = number
}

variable "policy_id" {
  description = "ID of the alert policy this condition sits in."
  type        = string
}

variable "name" {
  description = "Condition name as shown in New Relic."
  type        = string
}

variable "description" {
  description = "Human description; New Relic shows it on the condition page."
  type        = string
}

variable "query" {
  description = "NRQL with the environment filter already interpolated by the caller."
  type        = string
}

variable "aggregation_window" {
  description = "Metric aggregation window in seconds."
  type        = number
  default     = 60
}

variable "violation_time_limit_seconds" {
  description = "How long a lasting violation is remembered. Cron sweeper lag keeps 24h."
  type        = number
  default     = 3600
}

variable "warning" {
  description = "Warning threshold: operator, threshold, duration (seconds), occurrences."
  type = object({
    operator    = string
    threshold   = number
    duration    = number
    occurrences = string
  })
  default = null
}

variable "critical" {
  description = "Critical threshold: operator, threshold, duration (seconds), occurrences."
  type = object({
    operator    = string
    threshold   = number
    duration    = number
    occurrences = string
  })
  default = null
}

variable "fill" {
  description = "Static gap-fill value for quiet series (e.g. broker status gauges); null disables filling."
  type        = number
  default     = null
}
