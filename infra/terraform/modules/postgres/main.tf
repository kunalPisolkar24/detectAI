# Postgres v1: cluster + master secret + composed app URLs.
# Downgrades vs the locked prod spec (documented, to be closed later):
# - no Serverless v2 scaling block (Floci ignores it; added for real AWS)
# - no RDS Proxy (Floci has none; app hits cluster endpoints directly)
# - single master user; dedicated least-privilege app user comes with the
#   code-hygiene pass (needs data-plane access to CREATE USER)

resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "-_!$"
}

resource "aws_secretsmanager_secret" "master" {
  name = "detectai/pg/master"
  # 0 = force-delete on destroy so destroy/apply cycles work (Floci and AWS
  # both reserve deleted names otherwise). Prod overrides this to 30.
  recovery_window_in_days = var.secret_recovery_window
  description             = "Postgres master credentials (break-glass only, wired to nothing)"
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
  })
}

resource "aws_rds_cluster" "this" {
  cluster_identifier  = var.identifier
  engine              = var.engine
  engine_version      = var.engine_version
  database_name       = var.database_name
  master_username     = var.master_username
  master_password     = random_password.master.result
  skip_final_snapshot = true
}

locals {
  # Floci emulates no TLS on the data plane; real AWS requires it.
  # The query string is composed here so apps never assemble URLs.
  sslmode = var.db_sslmode

  database_url = "postgresql://${var.master_username}:${random_password.master.result}@${aws_rds_cluster.this.endpoint}:${aws_rds_cluster.this.port}/${var.database_name}?sslmode=${local.sslmode}"

  database_url_replica = "postgresql://${var.master_username}:${random_password.master.result}@${aws_rds_cluster.this.reader_endpoint}:${aws_rds_cluster.this.port}/${var.database_name}?sslmode=${local.sslmode}"
}

resource "aws_secretsmanager_secret" "urls" {
  name = "detectai/pg/urls"
  # See master secret: 0 keeps destroy/apply cycles working; prod uses 30.
  recovery_window_in_days = var.secret_recovery_window
  description             = "Composed app connection URLs (DATABASE_URL + DATABASE_URL_REPLICA)"
}

resource "aws_secretsmanager_secret_version" "urls" {
  secret_id = aws_secretsmanager_secret.urls.id
  secret_string = jsonencode({
    DATABASE_URL         = local.database_url
    DATABASE_URL_REPLICA = local.database_url_replica
  })
}
