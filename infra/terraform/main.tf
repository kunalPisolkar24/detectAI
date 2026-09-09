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
