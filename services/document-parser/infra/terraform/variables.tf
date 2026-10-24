variable "emulator_endpoint" {
  description = "Emulator endpoint (Floci or LocalStack, e.g. http://localhost:4566). Null or empty = real AWS."
  type        = string
  default     = null

  validation {
    condition     = var.emulator_endpoint == null || var.emulator_endpoint == "" || can(regex("^https?://", var.emulator_endpoint))
    error_message = "emulator_endpoint must be null, empty, or a valid http(s) URL (e.g. http://localhost:4566)."
  }
}

variable "aws_region" {
  description = "AWS region (the emulator accepts any value)."
  type        = string
  default     = "ap-southeast-2"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region (e.g. ap-southeast-2, us-east-1)."
  }
}

variable "secrets_name" {
  description = "Secrets Manager name of the document-parser secrets blob."
  type        = string
  default     = "detectai/document-parser/secrets"

  validation {
    condition     = can(regex("^detectai/document-parser/secrets$", var.secrets_name))
    error_message = "secrets_name is the fixed service contract detectai/document-parser/secrets."
  }
}

variable "api_key" {
  description = "API key stored as {\"API_KEY\": ...}. Null skips storing a version."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.api_key == null || length(var.api_key) >= 16
    error_message = "api_key must be at least 16 characters (or null to skip storing a version)."
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

variable "ssm_parameters" {
  description = "Non-secret runtime config seeded from .env via tools/secrets.py; each key becomes /detectai/document-parser/<KEY>."
  type        = map(string)
  default     = {}
}

variable "aws_account_id" {
  description = "Account id for the IAM policy ARNs. Emulator plane: pins the docs (defaults to 000000000000 when unset). Real AWS: a data source resolves it; this variable is ignored there."
  type        = string
  default     = null

  validation {
    condition     = var.aws_account_id == null || can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit account id (or unset)."
  }
}
