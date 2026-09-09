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
