# Floci-on-VPS environment. The endpoint is the ONLY divergence from real
# AWS: same modules, same variables, same secret/config contract.
floci_endpoint         = "https://4566-01m22s688qf78tcjxw3k1a3jdm.cloudspaces.litng.ai"
aws_region             = "ap-south-1"
cluster_identifier     = "detectai-pg-floci"
engine                 = "aurora-postgresql"
engine_version         = "16.6"
database_name          = "detect_ai"
master_username        = "dbadmin"
db_sslmode             = "disable"
secret_recovery_window = 0

# DocumentDB (chats) — Floci standalone (single mongo:7.0 container, dynamic port).
# For real AWS elastic sharded: docdb_mode="elastic", docdb_tls_enabled=true
docdb_cluster_identifier = "detectai-docdb-floci"
docdb_engine_version     = "5.0.0"
docdb_database_name      = "chat_db"
docdb_master_username    = "docdbadmin"
docdb_instance_class     = "db.r5.large"
docdb_tls_enabled        = false
docdb_mode               = "standalone"
