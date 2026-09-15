# Amazon MQ for RabbitMQ (payments + analytics).
# v1: single broker shared by payment_events + analytics.usage (quorum queues declared by apps).
# - Emulator: SINGLE_INSTANCE only (rejects CLUSTER_MULTI_AZ/ACTIVEMQ), exactly one Users[] entry
#   seeded into a real rabbitmq:3-management container, dynamic host ports via DescribeBroker.
# - Real AWS prod: CLUSTER_MULTI_AZ (3 nodes across AZs behind NLB, auto ha-mode=all policy).
# Scaling is vertical (host_instance_type) + deployment_mode; no broker autoscaling.
# Apps scale horizontally (gateway/workers) on queue depth. Queues stay short for maintenance sync.

variable "broker_name" {
  description = "Amazon MQ broker name."
  type        = string
  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,50}$", var.broker_name))
    error_message = "broker_name must be 1-50 chars, letters/numbers/_/-."
  }
}

variable "engine_version" {
  description = "RabbitMQ engine version. Pinned 3.13 keeps classic/quorum toggle; 4.2 forces quorum-only + m7g. Emulator example uses 3.13."
  type        = string
  default     = "3.13"
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+", var.engine_version))
    error_message = "engine_version must be numeric (e.g. 3.13)."
  }
}

variable "host_instance_type" {
  description = "Broker instance type. mq.m5.large for prod parity (emulator accepts any, e.g. mq.t3.micro for dev)."
  type        = string
  default     = "mq.m5.large"
  validation {
    condition     = can(regex("^mq\\.", var.host_instance_type))
    error_message = "host_instance_type must start with mq. (e.g. mq.m5.large)."
  }
}

variable "deployment_mode" {
  description = "SINGLE_INSTANCE (Floci/dev, 1 node + NLB + EBS) or CLUSTER_MULTI_AZ (prod, 3 nodes across AZs). Emulator rejects multi-AZ."
  type        = string
  default     = "SINGLE_INSTANCE"
  validation {
    condition     = contains(["SINGLE_INSTANCE", "CLUSTER_MULTI_AZ"], var.deployment_mode)
    error_message = "deployment_mode must be SINGLE_INSTANCE (Floci/LocalStack) or CLUSTER_MULTI_AZ (prod)"
  }
}

variable "username" {
  description = "Single admin username seeded at creation. Additional users via management UI/console (Terraform recreation on change)."
  type        = string
  default     = "mqadmin"
  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,31}$", var.username))
    error_message = "username must start with a letter, max 32 chars."
  }
}

variable "storage_type" {
  description = "Storage type. ebs only for RabbitMQ (efs/ldap/audit unsupported)."
  type        = string
  default     = "ebs"
  validation {
    condition     = contains(["ebs"], var.storage_type)
    error_message = "storage_type must be ebs for RabbitMQ."
  }
}

variable "publicly_accessible" {
  description = "Public access. false always (apps dial via VPC/NLB; emulator via mapped ports)."
  type        = bool
  default     = false
}

variable "auto_minor_version_upgrade" {
  description = "Auto minor version upgrades."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply modifications immediately (brief downtime). true for emulator/dev, false for prod (maintenance window)."
  type        = bool
  default     = true
}

variable "maintenance_day" {
  description = "Maintenance window day."
  type        = string
  default     = "SATURDAY"
  validation {
    condition     = contains(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"], var.maintenance_day)
    error_message = "maintenance_day must be a weekday name."
  }
}

variable "maintenance_time" {
  description = "Maintenance window time UTC HH:MM."
  type        = string
  default     = "04:00"
  validation {
    condition     = can(regex("^[0-9]{2}:[0-9]{2}$", var.maintenance_time))
    error_message = "maintenance_time must be HH:MM."
  }
}

variable "maintenance_timezone" {
  description = "Maintenance window timezone."
  type        = string
  default     = "UTC"
}

variable "subnet_ids" {
  description = "Subnet IDs for real AWS VPC. null for emulator (no VPC)."
  type        = list(string)
  default     = null
}

variable "security_groups" {
  description = "Security group IDs for real AWS. null for emulator."
  type        = list(string)
  default     = null
}

variable "queue_type" {
  description = "App queue type written to urls secret. quorum for Amazon MQ prod, classic for local standalone."
  type        = string
  default     = "quorum"
  validation {
    condition     = contains(["classic", "quorum"], var.queue_type)
    error_message = "queue_type must be classic or quorum"
  }
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window. 0 for Floci/dev, 30 for prod."
  type        = number
  default     = 0
  validation {
    condition     = var.secret_recovery_window == 0 || (var.secret_recovery_window >= 7 && var.secret_recovery_window <= 30)
    error_message = "secret_recovery_window must be 0 or 7-30."
  }
}

variable "aws_region" {
  description = "AWS region for endpoint fallback DNS (no API call)."
  type        = string
  default     = "ap-south-1"
  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid region."
  }
}

variable "tags" {
  description = "Extra tags for broker and secrets."
  type        = map(string)
  default     = {}
}
