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

variable "new_relic_license_key" {
  description = "New Relic ingest license key stored inside the blob. Null skips adding the key."
  type        = string
  default     = null
  sensitive   = true

  validation {
    condition     = var.new_relic_license_key == null || length(var.new_relic_license_key) >= 16
    error_message = "new_relic_license_key must be at least 16 characters (or null to skip adding the blob key)."
  }
}

variable "secret_recovery_window" {
  description = "Recovery window: 0 for emulator/dev cycles, 7-30 prod safety."
  type        = number
}

variable "aws_region" {
  description = "Region used to build the IAM policy resource ARNs (Floci accepts any value)."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid region code (e.g. ap-southeast-2)."
  }
}

variable "aws_account_id" {
  description = "Account id for IAM policy ARNs: resolved by the root module (data source on real AWS, pinned fallback on the emulator)."
  type        = string

  validation {
    # Non-empty only: on real AWS the value comes from caller identity and on
    # the emulator from the root default, so strict digit-shape checks belong
    # to the root variable (and terraform test's mock feeds placeholder text).
    condition     = length(var.aws_account_id) > 0
    error_message = "aws_account_id must be a non-empty account id."
  }
}

variable "ssm_parameters" {
  description = "Non-secret runtime config seeded from .env: each key becomes /detectai/document-parser/<KEY> (String)."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue(concat(
      [for name in keys(var.ssm_parameters) : can(regex("^[A-Z][A-Z0-9_]*$", name))],
      [for value in values(var.ssm_parameters) : value != ""],
    ))
    error_message = "ssm_parameters keys must be UPPER_SNAKE config names and values must be non-empty."
  }
}

variable "iam_role_name" {
  description = "Runtime identity of the service: reads the secret blob and the config params, nothing else."
  type        = string
  default     = "detectai-document-parser"

  validation {
    condition     = can(regex("^[a-zA-Z0-9+=,.@_-]+$", var.iam_role_name))
    error_message = "iam_role_name must be a valid IAM role name (letters, digits and + = , . @ _ -)."
  }
}
