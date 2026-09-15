mock_provider "aws" {}
mock_provider "random" {}

variables {
  emulator_endpoint                       = "http://localhost:4566"
  floci_endpoint                          = null
  aws_region                              = "ap-south-1"
  cluster_identifier                      = "detectai-pg-test"
  engine                                  = "aurora-postgresql"
  engine_version                          = "16.6"
  database_name                           = "detect_ai"
  master_username                         = "dbadmin"
  db_sslmode                              = "disable"
  secret_recovery_window                  = 0
  docdb_cluster_identifier                = "detectai-docdb-test"
  docdb_engine_version                    = "5.0.0"
  docdb_database_name                     = "chat_db"
  docdb_master_username                   = "docdbadmin"
  docdb_instance_class                    = "db.r5.large"
  docdb_tls_enabled                       = false
  docdb_mode                              = "standalone"
  redis_chat_identifier                   = "detectai-redis-chat-test"
  redis_chat_engine_version               = "7.1"
  redis_chat_node_type                    = "cache.t3.micro"
  redis_chat_transit_encryption_enabled   = false
  redis_chat_at_rest_encryption_enabled   = false
  redis_chat_snapshot_retention_limit     = 0
  redis_events_identifier                 = "detectai-redis-events-test"
  redis_events_engine_version             = "7.1"
  redis_events_node_type                  = "cache.t3.micro"
  redis_events_transit_encryption_enabled = false
  redis_events_at_rest_encryption_enabled = false
  redis_events_snapshot_retention_limit   = 0
  redis_users_identifier                  = "detectai-redis-users-test"
  redis_users_engine_version              = "7.1"
  redis_users_node_type                   = "cache.t3.micro"
  redis_users_transit_encryption_enabled  = false
  redis_users_at_rest_encryption_enabled  = false
  redis_users_snapshot_retention_limit    = 0
  mq_broker_name                          = "detectai-mq-test"
  mq_engine_version                       = "3.13"
  mq_host_instance_type                   = "mq.m5.large"
  mq_deployment_mode                      = "SINGLE_INSTANCE"
  mq_username                             = "mqadmin"
  mq_apply_immediately                    = true
  mq_queue_type                           = "quorum"
  mq_subnet_ids                           = null
  mq_security_groups                      = null
}

run "valid_emulator_plan" {
  command = plan

  # Plan should succeed with emulator endpoint; no assertions on computed outputs
  # because they are unknown until apply — success itself validates provider + variable cohesion.
}

run "valid_prod_plan_no_emulator" {
  command = plan

  variables {
    emulator_endpoint                     = null
    floci_endpoint                        = null
    db_sslmode                            = "require"
    secret_recovery_window                = 30
    docdb_tls_enabled                     = true
    redis_chat_transit_encryption_enabled = true
    redis_chat_at_rest_encryption_enabled = true
    mq_deployment_mode                    = "CLUSTER_MULTI_AZ"
  }
}
