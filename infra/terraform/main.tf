module "postgres" {
  source                 = "./modules/postgres"
  identifier             = var.cluster_identifier
  engine                 = var.engine
  engine_version         = var.engine_version
  database_name          = var.database_name
  master_username        = var.master_username
  db_sslmode             = var.db_sslmode
  secret_recovery_window = var.secret_recovery_window
}

module "docdb" {
  source                 = "./modules/docdb"
  identifier             = var.docdb_cluster_identifier
  engine_version         = var.docdb_engine_version
  database_name          = var.docdb_database_name
  master_username        = var.docdb_master_username
  instance_class         = var.docdb_instance_class
  tls_enabled            = var.docdb_tls_enabled
  secret_recovery_window = var.secret_recovery_window
  mode                   = var.docdb_mode
}

module "redis_chat" {
  source                       = "./modules/elasticache"
  identifier                   = var.redis_chat_identifier
  secret_prefix                = "chat"
  engine_version               = var.redis_chat_engine_version
  node_type                    = var.redis_chat_node_type
  transit_encryption_enabled   = var.redis_chat_transit_encryption_enabled
  at_rest_encryption_enabled   = var.redis_chat_at_rest_encryption_enabled
  snapshot_retention_limit     = var.redis_chat_snapshot_retention_limit
  secret_recovery_window       = var.secret_recovery_window
  # chat needs HA: 1 primary +1 replica
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
}

module "redis_events" {
  source                       = "./modules/elasticache"
  identifier                   = var.redis_events_identifier
  secret_prefix                = "events"
  description                  = "Paddle dedup (paddle:evt + payment:event:ts) single-node, noeviction, AOF"
  engine_version               = var.redis_events_engine_version
  node_type                    = var.redis_events_node_type
  parameter_group_name         = "default.redis7"
  transit_encryption_enabled   = var.redis_events_transit_encryption_enabled
  at_rest_encryption_enabled   = var.redis_events_at_rest_encryption_enabled
  snapshot_retention_limit     = var.redis_events_snapshot_retention_limit
  secret_recovery_window       = var.secret_recovery_window
  # events is single-node, no replica: maxmemory-policy noeviction + AOF, DB is authoritative
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
}

module "redis_users" {
  source                       = "./modules/elasticache"
  identifier                   = var.redis_users_identifier
  secret_prefix                = "users"
  description                  = "Users cache + rate-limit + analytics dedup single-node, volatile-ttl, AOF"
  engine_version               = var.redis_users_engine_version
  node_type                    = var.redis_users_node_type
  parameter_group_name         = "default.redis7"
  transit_encryption_enabled   = var.redis_users_transit_encryption_enabled
  at_rest_encryption_enabled   = var.redis_users_at_rest_encryption_enabled
  snapshot_retention_limit     = var.redis_users_snapshot_retention_limit
  secret_recovery_window       = var.secret_recovery_window
  # users is cache + counters with DB fallback, single-node, volatile-ttl, AOF
  num_cache_clusters         = 1
  automatic_failover_enabled = false
  multi_az_enabled           = false
}
