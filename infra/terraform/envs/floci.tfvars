# Floci-on-VPS environment. The endpoint is the ONLY divergence from real
# AWS: same modules, same variables, same secret/config contract.
# emulator_endpoint preferred; floci_endpoint alias for backward compat.
emulator_endpoint      = "https://4566-01m22s688qf78tcjxw3k1a3jdm.cloudspaces.litng.ai"
floci_endpoint         = "https://4566-01m22s688qf78tcjxw3k1a3jdm.cloudspaces.litng.ai"
aws_region             = "ap-south-1"
cluster_identifier     = "detectai-pg-floci"
engine                 = "aurora-postgresql"
engine_version         = "16.6"
database_name          = "detect_ai"
master_username        = "dbadmin"
db_sslmode             = "disable"
secret_recovery_window = 0

# DocumentDB (chats) — emulator standalone (single mongo:7.0 container, dynamic port).
# For real AWS elastic sharded: docdb_mode="elastic", docdb_tls_enabled=true
docdb_cluster_identifier = "detectai-docdb-floci"
docdb_engine_version     = "5.0.0"
docdb_database_name      = "chat_db"
docdb_master_username    = "docdbadmin"
docdb_instance_class     = "db.r5.large"
docdb_tls_enabled        = false
docdb_mode               = "standalone"

# ElastiCache Redis chat (streams+cache) — 1 primary + 1 replica, primary-for-all (cluster mode disabled)
# Emulator: proxy via bridge/host port; real AWS: TLS + snapshots
redis_chat_identifier                 = "detectai-redis-chat-floci"
redis_chat_engine_version             = "7.1"
redis_chat_node_type                  = "cache.t3.micro"
redis_chat_transit_encryption_enabled = false
redis_chat_at_rest_encryption_enabled = false
redis_chat_snapshot_retention_limit   = 0

# ElastiCache Redis events (Paddle dedup) — single-node, no replica, AOF noeviction, DB authoritative
redis_events_identifier                 = "detectai-redis-events-floci"
redis_events_engine_version             = "7.1"
redis_events_node_type                  = "cache.t3.micro"
redis_events_transit_encryption_enabled = false
redis_events_at_rest_encryption_enabled = false
redis_events_snapshot_retention_limit   = 0

# ElastiCache Redis users (user cache + rate-limit + analytics dedup) — single-node, volatile-ttl, AOF, DB fallback
redis_users_identifier                 = "detectai-redis-users-floci"
redis_users_engine_version             = "7.1"
redis_users_node_type                  = "cache.t3.micro"
redis_users_transit_encryption_enabled = false
redis_users_at_rest_encryption_enabled = false
redis_users_snapshot_retention_limit   = 0

# Amazon MQ RabbitMQ (payments + analytics quorum queues) — emulator SINGLE_INSTANCE only.
# Prod uses CLUSTER_MULTI_AZ (see envs/prod.tfvars); emulator rejects multi-AZ modes.
mq_broker_name        = "detectai-mq-floci"
mq_engine_version     = "3.13"
mq_host_instance_type = "mq.m5.large"
mq_deployment_mode    = "SINGLE_INSTANCE"
mq_username           = "mqadmin"
mq_apply_immediately  = true
mq_queue_type         = "quorum"
