# Amazon MQ for RabbitMQ broker + secrets (mirrors postgres/docdb/elasticache contract).
# Floci note: CreateBroker Users must be exactly one entry; User API (CreateUser etc.)
# is ActiveMQ-only and rejected for RabbitMQ. AMQP (5672) + management (15672)
# are mapped to dynamic host ports; always read endpoints from DescribeBroker.

resource "random_password" "mq" {
  length           = 32
  special          = true
  override_special = "-_!$"
}

resource "aws_secretsmanager_secret" "master" {
  name                    = "detectai/mq/master"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Amazon MQ RabbitMQ admin credentials (break-glass only, wired to broker Users[0])"
}

resource "aws_secretsmanager_secret_version" "master" {
  secret_id = aws_secretsmanager_secret.master.id
  secret_string = jsonencode({
    username = var.username
    password = random_password.mq.result
  })
}

resource "aws_mq_broker" "this" {
  broker_name                = var.broker_name
  engine_type                = "RABBITMQ"
  engine_version             = var.engine_version
  host_instance_type         = var.host_instance_type
  deployment_mode            = var.deployment_mode
  storage_type               = var.storage_type
  publicly_accessible        = var.publicly_accessible
  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  apply_immediately          = var.apply_immediately

  subnet_ids      = var.subnet_ids
  security_groups = var.security_groups

  maintenance_window_start_time {
    day_of_week = var.maintenance_day
    time_of_day = var.maintenance_time
    time_zone   = var.maintenance_timezone
  }

  logs {
    general = true
  }

  user {
    username = var.username
    password = random_password.mq.result
  }

  # Floci stores but does not enforce: encryption_options, configuration, tags.
}

locals {
  raw_endpoint = try(aws_mq_broker.this.instances[0].endpoints[0], "")
  is_amqps     = local.raw_endpoint != "" && can(regex("^amqps://", local.raw_endpoint))
  hostport     = local.raw_endpoint != "" ? replace(replace(local.raw_endpoint, "amqps://", ""), "amqp://", "") : "${aws_mq_broker.this.id}.mq.${var.aws_region}.amazonaws.com:5671"
  scheme       = local.raw_endpoint == "" ? "amqps" : (local.is_amqps ? "amqps" : "amqp")
  amqp_url     = "${local.scheme}://${var.username}:${urlencode(random_password.mq.result)}@${local.hostport}/"
  console_url  = try(aws_mq_broker.this.instances[0].console_url, "")
}

resource "aws_secretsmanager_secret" "urls" {
  name                    = "detectai/mq/urls"
  recovery_window_in_days = var.secret_recovery_window
  description             = "Composed Amazon MQ URLs (RABBITMQ_URL amqps + UI + QUEUE_TYPE)"
  depends_on              = [aws_mq_broker.this]
}

resource "aws_secretsmanager_secret_version" "urls" {
  secret_id = aws_secretsmanager_secret.urls.id
  secret_string = jsonencode({
    RABBITMQ_URL        = local.amqp_url
    RABBITMQ_UI_URL     = local.console_url
    RABBITMQ_QUEUE_TYPE = var.queue_type
    RABBITMQ_ENDPOINT   = local.raw_endpoint
  })
}
