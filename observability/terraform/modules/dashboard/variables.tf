variable "account_id" {
  description = "New Relic account the board and its tags belong to."
  type        = number
}

variable "json" {
  description = "Rendered board JSON, already run through templatefile at the call site."
  type        = string
}

variable "scope" {
  description = "Team/service grouping tag value: a service name, or platform/datastores for the all-infra boards."
  type        = string
}

variable "kind" {
  description = "Platform boards describe the estate; service boards describe one deployable."
  type        = string

  validation {
    condition     = contains(["platform", "service-dashboard"], var.kind)
    error_message = "kind must be platform or service-dashboard."
  }
}

variable "env" {
  description = "Data-filter environment the board reads: prod workspace boards take var.environment, dev twins stay literal dev."
  type        = string

  validation {
    condition     = contains(["prod", "dev", "floci"], var.env)
    error_message = "env must be prod, dev, or floci."
  }
}
