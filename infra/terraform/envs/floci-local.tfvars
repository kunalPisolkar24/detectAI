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
