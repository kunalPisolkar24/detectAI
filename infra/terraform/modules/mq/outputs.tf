output "broker_id" {
  value = aws_mq_broker.this.id
}

output "broker_arn" {
  value = aws_mq_broker.this.arn
}

output "amqp_endpoint" {
  description = "Raw amqps://host:5671 endpoint from DescribeBroker (dynamic port on Floci)."
  value       = try(aws_mq_broker.this.instances[0].endpoints[0], "")
}

output "console_url" {
  description = "RabbitMQ management UI URL."
  value       = try(aws_mq_broker.this.instances[0].console_url, "")
}

output "amqp_url" {
  description = "Composed amqps://user:pass@host:5671/ URL for apps (TLS, port 5671)."
  value       = local.amqp_url
  sensitive   = true
}

output "master_secret_arn" {
  value = aws_secretsmanager_secret.master.arn
}

output "urls_secret_arn" {
  value = aws_secretsmanager_secret.urls.arn
}

output "engine_version" {
  value = var.engine_version
}

output "deployment_mode" {
  value = var.deployment_mode
}
