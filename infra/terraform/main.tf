module "queues" {
  source = "./modules/queues"

  queues                     = var.queues
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
}
