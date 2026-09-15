# Postgres: Aurora cluster + instances + master secret + composed app URLs.
# Clean contract:
# - Inputs are validated (identifier, engine, sslmode, recovery window).
# - Password is urlencode'd for URI safety (matches docdb/elasticache).
# - Instances are explicit (1 for emulator, 2 for prod HA); cluster alone creates no compute on real AWS.
# - Downgrades vs locked prod spec (documented):
#   - no Serverless v2 scaling block (Floci ignores it; added for real AWS via instance_count/instance_class)
#   - no RDS Proxy (emulator has none; app hits cluster endpoints directly)
#   - single master user; least-privilege app user is a future hygiene pass (needs CREATE USER data-plane)

resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "-_!$"
}

resource "aws_secretsmanager_secret" "master" {
  name                    = "detectai/pg/master"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Postgres master credentials (break-glass only, wired to nothing)"
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
  })
}

resource "aws_rds_cluster" "this" {
  cluster_identifier              = var.identifier
  engine                          = var.engine
  engine_version                  = var.engine_version
  database_name                   = var.database_name
  master_username                 = var.master_username
  master_password                 = random_password.master.result
  backup_retention_period         = var.backup_retention_period
  storage_encrypted               = var.storage_encrypted
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = true
  enabled_cloudwatch_logs_exports = []
  tags                            = var.tags
}

resource "aws_rds_cluster_instance" "this" {
  count              = var.instance_count
  identifier         = "${var.identifier}-${count.index + 1}"
  cluster_identifier = aws_rds_cluster.this.id
  instance_class     = var.instance_class
  engine             = var.engine
  engine_version     = var.engine_version

  performance_insights_enabled = false
  tags                         = var.tags
}

locals {
  # Emulator has no TLS on data plane; real AWS requires it. Compose URLs here so apps never assemble.
  sslmode              = var.db_sslmode
  encoded_password     = urlencode(random_password.master.result)
  database_url         = "postgresql://${var.master_username}:${local.encoded_password}@${aws_rds_cluster.this.endpoint}:${aws_rds_cluster.this.port}/${var.database_name}?sslmode=${local.sslmode}"
  database_url_replica = "postgresql://${var.master_username}:${local.encoded_password}@${aws_rds_cluster.this.reader_endpoint}:${aws_rds_cluster.this.port}/${var.database_name}?sslmode=${local.sslmode}"
}

resource "aws_secretsmanager_secret" "urls" {
  name                    = "detectai/pg/urls"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Composed app connection URLs (DATABASE_URL + DATABASE_URL_REPLICA)"
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "urls" {
  secret_id = aws_secretsmanager_secret.urls.id
  secret_string = jsonencode({
    DATABASE_URL         = local.database_url
    DATABASE_URL_REPLICA = local.database_url_replica
  })
}

check "cluster_has_instances" {
  assert {
    condition     = var.instance_count >= 1
    error_message = "Postgres cluster must have at least 1 instance (emulator:1, prod:2)."
  }
}
