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
