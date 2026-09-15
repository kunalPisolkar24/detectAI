variable "emulator_endpoint" {
  description = "Generic emulator endpoint (Floci or LocalStack). Example: http://localhost:4566. Null or empty = real AWS. Preferred over floci_endpoint."
  type        = string
  default     = null

  validation {
    condition     = var.emulator_endpoint == null || var.emulator_endpoint == "" || can(regex("^https?://", var.emulator_endpoint))
    error_message = "emulator_endpoint must be null, empty, or a valid http(s) URL (e.g. http://localhost:4566)."
  }
}

variable "floci_endpoint" {
  description = "Deprecated: use emulator_endpoint. Kept for backward compatibility. Empty string or null = real AWS, otherwise emulator URL."
  type        = string
  default     = null

  validation {
    condition     = var.floci_endpoint == null || var.floci_endpoint == "" || can(regex("^https?://", var.floci_endpoint))
    error_message = "floci_endpoint must be null, empty, or a valid http(s) URL."
  }
}

variable "aws_region" {
  description = "AWS region (Floci/LocalStack accept any value)."
  type        = string
  default     = "ap-south-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS region (e.g. ap-south-1, us-east-1)."
  }
}

variable "cluster_identifier" {
  description = "RDS cluster identifier."
  type        = string
  default     = "detectai-pg-floci"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.cluster_identifier))
    error_message = "cluster_identifier must start with a letter, contain only lowercase letters, numbers, hyphens, max 63 chars."
  }
}

variable "engine" {
  description = "RDS engine. aurora-postgresql for cluster shape."
  type        = string
  default     = "aurora-postgresql"

  validation {
    condition     = contains(["aurora-postgresql", "aurora-mysql", "postgres"], var.engine)
    error_message = "engine must be one of aurora-postgresql, aurora-mysql, postgres."
  }
}

variable "engine_version" {
  description = "Pinned engine version (Floci cannot discover versions, so never data-source this)."
  type        = string
  default     = "16.6"

  validation {
    condition     = length(var.engine_version) > 0 && can(regex("^[0-9]+\\.[0-9]+", var.engine_version))
    error_message = "engine_version must be a pinned numeric version (e.g. 16.6)."
  }
}

variable "database_name" {
  description = "Initial database name. Must match app POSTGRES_DB."
  type        = string
  default     = "detect_ai"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.database_name))
    error_message = "database_name must start with a letter, contain only letters, numbers, underscores."
  }
}

variable "master_username" {
  description = "Master username. v1 uses this user for app URLs too; dedicated app user comes later."
  type        = string
  default     = "dbadmin"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,15}$", var.master_username)) && var.master_username != "admin"
    error_message = "master_username must start with a letter, max 16 chars, not 'admin'."
  }
}

variable "db_sslmode" {
  description = "SSL mode for composed DATABASE_URLs. disable for Floci/LocalStack, require for real AWS."
  type        = string
  default     = "disable"

  validation {
    condition     = contains(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"], var.db_sslmode)
    error_message = "db_sslmode must be one of disable, allow, prefer, require, verify-ca, verify-full."
  }
}

variable "secret_recovery_window" {
  description = "Secrets Manager recovery window. 0 for Floci/dev destroy/apply cycles, 7-30 for prod safety."
  type        = number
  default     = 0

  validation {
    condition     = var.secret_recovery_window == 0 || (var.secret_recovery_window >= 7 && var.secret_recovery_window <= 30)
    error_message = "secret_recovery_window must be 0 (emulator/dev) or 7-30 (prod)."
  }
}

variable "docdb_cluster_identifier" {
  description = "DocumentDB cluster identifier for chats."
  type        = string
  default     = "detectai-docdb-floci"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.docdb_cluster_identifier))
    error_message = "docdb_cluster_identifier must start with a letter, lowercase alphanum + hyphen, max 63 chars."
  }
}

variable "docdb_engine_version" {
  description = "DocumentDB engine version. Floci/LocalStack accept 3.6.0, 4.0.0, 5.0.0, 5.0.1, 8.0.0, 8.0.1."
  type        = string
  default     = "5.0.0"

  validation {
    condition     = contains(["3.6.0", "4.0.0", "5.0.0", "5.0.1", "8.0.0", "8.0.1"], var.docdb_engine_version)
    error_message = "docdb_engine_version must be one of 3.6.0, 4.0.0, 5.0.0, 5.0.1, 8.0.0, 8.0.1."
  }
}

variable "docdb_database_name" {
  description = "DocumentDB initial database. Must match chats MONGO_DATABASE."
  type        = string
  default     = "chat_db"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.docdb_database_name))
    error_message = "docdb_database_name must start with a letter, letters/numbers/underscores only."
  }
}

variable "docdb_master_username" {
  description = "DocumentDB master username."
  type        = string
  default     = "docdbadmin"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,15}$", var.docdb_master_username))
    error_message = "docdb_master_username must start with a letter, max 16 chars."
  }
}

variable "docdb_instance_class" {
  description = "DocumentDB instance class. Floci/LocalStack accept any."
  type        = string
  default     = "db.r5.large"

  validation {
    condition     = can(regex("^db\\.", var.docdb_instance_class))
    error_message = "docdb_instance_class must start with db. (e.g. db.r5.large)."
  }
}

variable "docdb_tls_enabled" {
  description = "TLS for DocumentDB connections. false for Floci/LocalStack, true for real AWS."
  type        = bool
  default     = false
}

variable "docdb_mode" {
  description = "DocumentDB mode: standalone (Floci/LocalStack, single mongo container) or elastic (real AWS sharded). App derives MONGO_MODE from this."
  type        = string
  default     = "standalone"

  validation {
    condition     = contains(["standalone", "elastic"], var.docdb_mode)
    error_message = "docdb_mode must be 'standalone' or 'elastic'."
  }
}

variable "redis_chat_identifier" {
  description = "ElastiCache replication group identifier for chat streams+cache (primary-for-all)."
  type        = string
  default     = "detectai-redis-chat-floci"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,39}$", var.redis_chat_identifier))
    error_message = "redis_chat_identifier must be lowercase letter + alphanum/hyphen, max 40 chars."
  }
}

variable "redis_chat_engine_version" {
  description = "Redis engine version. Pinned 7.1 for dev/prod consistency (Floci default valkey overridden)."
  type        = string
  default     = "7.1"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.redis_chat_engine_version))
    error_message = "redis_chat_engine_version must be numeric (e.g. 7.1)."
  }
}

variable "redis_chat_node_type" {
  description = "ElastiCache node type. cache.t3.micro for Floci/dev, cache.r6g.large for prod."
  type        = string
  default     = "cache.t3.micro"

  validation {
    condition     = can(regex("^cache\\.", var.redis_chat_node_type))
    error_message = "redis_chat_node_type must start with cache. (e.g. cache.t3.micro)."
  }
}

variable "redis_chat_transit_encryption_enabled" {
  description = "Transit encryption (TLS). false for Floci/LocalStack, true for prod (rediss://)."
  type        = bool
  default     = false
}

variable "redis_chat_at_rest_encryption_enabled" {
  description = "At-rest encryption. false for Floci/LocalStack, true for prod."
  type        = bool
  default     = false
}

variable "redis_chat_snapshot_retention_limit" {
  description = "Snapshot retention days. 0 for Floci/dev, 7 for prod (streams durability)."
  type        = number
  default     = 0

  validation {
    condition     = var.redis_chat_snapshot_retention_limit >= 0 && var.redis_chat_snapshot_retention_limit <= 35
    error_message = "redis_chat_snapshot_retention_limit must be 0-35."
  }
}

variable "redis_events_identifier" {
  description = "ElastiCache replication group identifier for Paddle dedup (single-node, no replica)."
  type        = string
  default     = "detectai-redis-events-floci"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,39}$", var.redis_events_identifier))
    error_message = "redis_events_identifier must be lowercase letter + alphanum/hyphen, max 40 chars."
  }
}

variable "redis_events_engine_version" {
  description = "Redis engine version for events. Pinned 7.1."
  type        = string
  default     = "7.1"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.redis_events_engine_version))
    error_message = "redis_events_engine_version must be numeric (e.g. 7.1)."
  }
}

variable "redis_events_node_type" {
  description = "Node type for events. cache.t3.micro Floci/dev (tiny), cache.t4g.small prod."
  type        = string
  default     = "cache.t3.micro"

  validation {
    condition     = can(regex("^cache\\.", var.redis_events_node_type))
    error_message = "redis_events_node_type must start with cache."
  }
}

variable "redis_events_transit_encryption_enabled" {
  description = "Transit encryption for events. false Floci/LocalStack, true prod."
  type        = bool
  default     = false
}

variable "redis_events_at_rest_encryption_enabled" {
  description = "At-rest encryption for events. false Floci/LocalStack, true prod."
  type        = bool
  default     = false
}

variable "redis_events_snapshot_retention_limit" {
  description = "Snapshot retention for events. 0 Floci/LocalStack, 1 prod (AOF + daily RDB)."
  type        = number
  default     = 0

  validation {
    condition     = var.redis_events_snapshot_retention_limit >= 0 && var.redis_events_snapshot_retention_limit <= 35
    error_message = "redis_events_snapshot_retention_limit must be 0-35."
  }
}

variable "redis_users_identifier" {
  description = "ElastiCache replication group identifier for users cache+rate-limit (single-node)."
  type        = string
  default     = "detectai-redis-users-floci"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,39}$", var.redis_users_identifier))
    error_message = "redis_users_identifier must be lowercase letter + alphanum/hyphen, max 40 chars."
  }
}

variable "redis_users_engine_version" {
  description = "Redis engine version for users. Pinned 7.1."
  type        = string
  default     = "7.1"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+$", var.redis_users_engine_version))
    error_message = "redis_users_engine_version must be numeric."
  }
}

variable "redis_users_node_type" {
  description = "Node type for users. cache.t3.micro Floci/dev, cache.t4g.small prod."
  type        = string
  default     = "cache.t3.micro"

  validation {
    condition     = can(regex("^cache\\.", var.redis_users_node_type))
    error_message = "redis_users_node_type must start with cache."
  }
}

variable "redis_users_transit_encryption_enabled" {
  description = "Transit encryption for users. false Floci/LocalStack, true prod."
  type        = bool
  default     = false
}

variable "redis_users_at_rest_encryption_enabled" {
  description = "At-rest encryption for users. false Floci/LocalStack, true prod."
  type        = bool
  default     = false
}

variable "redis_users_snapshot_retention_limit" {
  description = "Snapshot retention for users. 0 Floci/LocalStack, 1 prod (volatile-ttl AOF)."
  type        = number
  default     = 0

  validation {
    condition     = var.redis_users_snapshot_retention_limit >= 0 && var.redis_users_snapshot_retention_limit <= 35
    error_message = "redis_users_snapshot_retention_limit must be 0-35."
  }
}

variable "mq_broker_name" {
  description = "Amazon MQ broker name for RabbitMQ (payments + analytics quorum queues)."
  type        = string
  default     = "detectai-mq-floci"

  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,50}$", var.mq_broker_name))
    error_message = "mq_broker_name must be 1-50 chars, letters/numbers/_/-."
  }
}

variable "mq_engine_version" {
  description = "RabbitMQ engine version. Pinned 3.13 (Floci + classic/quorum toggle). Never data-source."
  type        = string
  default     = "3.13"

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+", var.mq_engine_version))
    error_message = "mq_engine_version must be numeric (e.g. 3.13)."
  }
}

variable "mq_host_instance_type" {
  description = "Broker instance type. mq.m5.large prod parity; mq.t3.micro allowed for Floci/dev."
  type        = string
  default     = "mq.m5.large"

  validation {
    condition     = can(regex("^mq\\.", var.mq_host_instance_type))
    error_message = "mq_host_instance_type must start with mq. (e.g. mq.m5.large)."
  }
}

variable "mq_deployment_mode" {
  description = "SINGLE_INSTANCE for Floci/dev, CLUSTER_MULTI_AZ for prod (3 nodes AZ-spread + NLB)."
  type        = string
  default     = "SINGLE_INSTANCE"

  validation {
    condition     = contains(["SINGLE_INSTANCE", "CLUSTER_MULTI_AZ"], var.mq_deployment_mode)
    error_message = "mq_deployment_mode must be SINGLE_INSTANCE (Floci/LocalStack) or CLUSTER_MULTI_AZ (prod)."
  }
}

variable "mq_username" {
  description = "Single admin username seeded at creation. Extra users via management UI (change forces recreation)."
  type        = string
  default     = "mqadmin"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,31}$", var.mq_username))
    error_message = "mq_username must start with a letter, max 32 chars."
  }
}

variable "mq_apply_immediately" {
  description = "Apply broker modifications immediately (brief downtime). true Floci/dev, false prod."
  type        = bool
  default     = true
}

variable "mq_queue_type" {
  description = "Queue type written to urls secret. quorum for Amazon MQ prod, classic for local standalone."
  type        = string
  default     = "quorum"

  validation {
    condition     = contains(["classic", "quorum"], var.mq_queue_type)
    error_message = "mq_queue_type must be classic or quorum."
  }
}

variable "mq_subnet_ids" {
  description = "Subnet IDs for real AWS VPC. null for Floci/LocalStack."
  type        = list(string)
  default     = null
}

variable "mq_security_groups" {
  description = "Security group IDs for real AWS. null for Floci/LocalStack."
  type        = list(string)
  default     = null
}
