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
