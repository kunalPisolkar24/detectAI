# Amazon MQ for RabbitMQ (payments + analytics).
# v1: single broker shared by payment_events + analytics.usage (quorum queues declared by apps).
# - Floci: SINGLE_INSTANCE only (rejects CLUSTER_MULTI_AZ/ACTIVEMQ), exactly one Users[] entry
#   seeded into a real rabbitmq:3-management container, dynamic host ports via DescribeBroker.
# - Real AWS prod: CLUSTER_MULTI_AZ (3 nodes across AZs behind NLB, auto ha-mode=all policy).
# Scaling is vertical (host_instance_type) + deployment_mode; no broker autoscaling.
# Apps scale horizontally (gateway/workers) on queue depth. Queues stay short for maintenance sync.

variable "broker_name" {
  description = "Amazon MQ broker name."
  type        = string
}

variable "engine_version" {
  description = "RabbitMQ engine version. Pinned 3.13 keeps classic/quorum toggle; 4.2 forces quorum-only + m7g. Floci example uses 3.13."
  type        = string
  default     = "3.13"
}

variable "host_instance_type" {
  description = "Broker instance type. mq.m5.large for prod parity (Floci accepts any, e.g. mq.t3.micro for dev)."
  type        = string
  default     = "mq.m5.large"
}

variable "deployment_mode" {
  description = "SINGLE_INSTANCE (Floci/dev, 1 node + NLB + EBS) or CLUSTER_MULTI_AZ (prod, 3 nodes across AZs). Floci rejects multi-AZ."
  type        = string
  default     = "SINGLE_INSTANCE"
  validation {
    condition     = contains(["SINGLE_INSTANCE", "CLUSTER_MULTI_AZ"], var.deployment_mode)
    error_message = "deployment_mode must be SINGLE_INSTANCE (Floci) or CLUSTER_MULTI_AZ (prod)"
  }
}

variable "username" {
  description = "Single admin username seeded at creation. Additional users via management UI/console (Terraform recreation on change)."
  type        = string
  default     = "mqadmin"
}

variable "storage_type" {
  description = "Storage type. ebs only for RabbitMQ (efs/ldap/audit unsupported)."
  type        = string
  default     = "ebs"
}

variable "publicly_accessible" {
  description = "Public access. false always (apps dial via VPC/NLB; Floci via mapped ports)."
  type        = bool
  default     = false
}

variable "auto_minor_version_upgrade" {
  description = "Auto minor version upgrades."
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply modifications immediately (brief downtime). true for Floci/dev, false for prod (maintenance window)."
  type        = bool
  default     = true
}

variable "maintenance_day" {
  description = "Maintenance window day."
  type        = string
  default     = "SATURDAY"
}

variable "maintenance_time" {
  description = "Maintenance window time UTC HH:MM."
  type        = string
  default     = "04:00"
}

variable "maintenance_timezone" {
  description = "Maintenance window timezone."
  type        = string
  default     = "UTC"
}

variable "subnet_ids" {
  description = "Subnet IDs for real AWS VPC. null for Floci (no VPC)."
  type        = list(string)
  default     = null
}

variable "security_groups" {
  description = "Security group IDs for real AWS. null for Floci."
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
}

variable "aws_region" {
  description = "AWS region for endpoint fallback DNS (no API call)."
  type        = string
  default     = "ap-south-1"
}
