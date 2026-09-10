# Floci-local (personal machine). Endpoint is the ONLY divergence from VPS/real AWS.
floci_endpoint         = "http://localhost:4566"
aws_region             = "ap-south-1"
cluster_identifier     = "detectai-pg-local"
engine                 = "aurora-postgresql"
engine_version         = "16.6"
database_name          = "detect_ai"
master_username        = "dbadmin"
db_sslmode             = "disable"
secret_recovery_window = 0

docdb_cluster_identifier = "detectai-docdb-local"
docdb_engine_version     = "5.0.0"
docdb_database_name      = "chat_db"
docdb_master_username    = "docdbadmin"
docdb_instance_class     = "db.r5.large"
docdb_tls_enabled        = false
docdb_mode               = "standalone"

redis_chat_identifier                 = "detectai-redis-chat-local"
redis_chat_engine_version             = "7.1"
redis_chat_node_type                  = "cache.t3.micro"
redis_chat_transit_encryption_enabled = false
redis_chat_at_rest_encryption_enabled = false
redis_chat_snapshot_retention_limit   = 0

redis_events_identifier                 = "detectai-redis-events-local"
redis_events_engine_version             = "7.1"
redis_events_node_type                  = "cache.t3.micro"
redis_events_transit_encryption_enabled = false
redis_events_at_rest_encryption_enabled = false
redis_events_snapshot_retention_limit   = 0

redis_users_identifier                 = "detectai-redis-users-local"
redis_users_engine_version             = "7.1"
redis_users_node_type                  = "cache.t3.micro"
redis_users_transit_encryption_enabled = false
redis_users_at_rest_encryption_enabled = false
redis_users_snapshot_retention_limit   = 0

# Amazon MQ RabbitMQ (payments + analytics quorum queues) — Floci SINGLE_INSTANCE only.
mq_broker_name        = "detectai-mq-local"
mq_engine_version     = "3.13"
mq_host_instance_type = "mq.m5.large"
mq_deployment_mode    = "SINGLE_INSTANCE"
mq_username           = "mqadmin"
mq_apply_immediately  = true
mq_queue_type         = "quorum"
