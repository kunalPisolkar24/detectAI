variable "secrets_name" {
  description = "Secrets Manager name of the document-parser secrets blob."
  type        = string

  validation {
    condition     = can(regex("^detectai/document-parser/secrets$", var.secrets_name))
    error_message = "secrets_name is the fixed service contract detectai/document-parser/secrets."
  }
}

variable "api_key" {
  description = "API key stored inside the blob. Null keeps the container but stores no version."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.api_key == null || length(var.api_key) >= 16
    error_message = "api_key must be at least 16 characters (or null to skip storing a version)."
  }
}

variable "secret_recovery_window" {
  description = "Recovery window: 0 for emulator/dev cycles, 7-30 prod safety."
  type        = number
}
