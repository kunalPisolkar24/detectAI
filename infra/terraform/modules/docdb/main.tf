# DocumentDB (mongo-compatible chats store).
# Supports two shapes with one interface:
# - standalone (default, Floci-real): aws_docdb_cluster + aws_docdb_cluster_instance
#   Uses real mongo:7.0 container, endpoint/port from DescribeDBClusters, MONGO_MODE=standalone
# - elastic (future, real AWS): documented for prod - Floci currently mocks it; app uses
#   MONGO_MODE=sharded and issues enableSharding + shardCollection(chat_id:hashed) at boot.
# Floci note: DocumentDB shares RDS Query protocol + rds signing scope, engine=docdb routes to DocDB handler.

resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "-_!$"
}

resource "aws_secretsmanager_secret" "master" {
  name                    = "detectai/docdb/master"
  recovery_window_in_days = var.secret_recovery_window
  description             = "DocumentDB master credentials (break-glass only)"
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({
    username = var.master_username
    password = random_password.master.result
  })
}

# Standalone (Floci-supported): real DocumentDB cluster with instance.
resource "aws_docdb_cluster" "this" {
  cluster_identifier  = var.identifier
  engine              = "docdb"
  engine_version      = var.engine_version
  master_username     = var.master_username
  master_password     = random_password.master.result
  port                = var.port
  skip_final_snapshot = true

  # Floci stores but does not enforce: deletion_protection, backup windows, etc.
}

resource "aws_docdb_cluster_instance" "this" {
  identifier         = "${var.identifier}-instance-1"
  cluster_identifier = aws_docdb_cluster.this.id
  instance_class     = var.instance_class
  engine             = "docdb"
}

locals {
  # Floci dynamic port: DescribeDBClusters.Port is the host-mapped port (host mode) or 27017 (shared network).
  # Compose secrets/contracts should read endpoint/port from DescribeDBClusters, not assume 27017.
  # For local compose we keep mongodb://mongo-chat:27017 fallback, but terraform composes the Floci/AWS URI.

  tls_param = var.tls_enabled ? "true" : "false"

  # retryWrites=false required for DocumentDB/elastic and safe on standalone mongod.
  # TLS CA file is provided out-of-band to app (MONGO_TLS_CA_FILE).
  # urlencode password because random_password may contain $/_/! which are URI-reserved; user in admin DB
  mongo_uri = "mongodb://${var.master_username}:${urlencode(random_password.master.result)}@${aws_docdb_cluster.this.endpoint}:${aws_docdb_cluster.this.port}/${var.database_name}?tls=${local.tls_param}&retryWrites=false&authSource=admin"

  # Elastic mode would use aws_docdbelastic_cluster (not yet in Floci); we expose the same secret shape
  # so app code is identical. For now elastic is var-only; standalone resources above are still created.
  mongo_mode = var.mode == "elastic" ? "sharded" : "standalone"
}

resource "aws_secretsmanager_secret" "urls" {
  name                    = "detectai/docdb/urls"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Composed DocumentDB connection URLs (MONGO_URI + MONGO_DATABASE + MONGO_MODE)"
  depends_on              = [aws_docdb_cluster_instance.this]
}

resource "aws_secretsmanager_secret_version" "urls" {
  secret_id = aws_secretsmanager_secret.urls.id
  secret_string = jsonencode({
    MONGO_URI      = local.mongo_uri
    MONGO_DATABASE = var.database_name
    MONGO_MODE     = local.mongo_mode
  })
}
