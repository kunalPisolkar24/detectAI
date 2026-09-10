# Production (real AWS). No floci_endpoint: provider talks to real AWS.
# MQ is CLUSTER_MULTI_AZ (3 nodes across AZs behind NLB, auto ha-mode=all).
# Scaling is vertical (mq_host_instance_type) — no broker autoscaling.
floci_endpoint         = ""
aws_region             = "ap-south-1"
cluster_identifier     = "detectai-pg-prod"
engine                 = "aurora-postgresql"
engine_version         = "16.6"
database_name          = "detect_ai"
master_username        = "dbadmin"
db_sslmode             = "require"
secret_recovery_window = 30

docdb_cluster_identifier = "detectai-docdb-prod"
docdb_engine_version     = "5.0.0"
docdb_database_name      = "chat_db"
docdb_master_username    = "docdbadmin"
docdb_instance_class     = "db.r5.large"
docdb_tls_enabled        = true
docdb_mode               = "standalone"

redis_chat_identifier                 = "detectai-redis-chat-prod"
redis_chat_engine_version             = "7.1"
redis_chat_node_type                  = "cache.r6g.large"
redis_chat_transit_encryption_enabled = true
redis_chat_at_rest_encryption_enabled = true
redis_chat_snapshot_retention_limit   = 7

redis_events_identifier                 = "detectai-redis-events-prod"
redis_events_engine_version             = "7.1"
redis_events_node_type                  = "cache.t4g.small"
redis_events_transit_encryption_enabled = true
redis_events_at_rest_encryption_enabled = true
redis_events_snapshot_retention_limit   = 1

redis_users_identifier                 = "detectai-redis-users-prod"
redis_users_engine_version             = "7.1"
redis_users_node_type                  = "cache.t4g.small"
redis_users_transit_encryption_enabled = true
redis_users_at_rest_encryption_enabled = true
redis_users_snapshot_retention_limit   = 1

# Amazon MQ RabbitMQ prod: 3-node cluster, apply via maintenance window.
mq_broker_name        = "detectai-mq-prod"
mq_engine_version     = "3.13"
mq_host_instance_type = "mq.m5.large"
mq_deployment_mode    = "CLUSTER_MULTI_AZ"
mq_username           = "mqadmin"
mq_apply_immediately  = false
mq_queue_type         = "quorum"
# NOTE: set mq_subnet_ids + mq_security_groups via -var or prod override (VPC-specific).
