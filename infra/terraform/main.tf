module "queues" {
  source = "./modules/queues"
  count  = length(var.queues) > 0 ? 1 : 0

  queues                     = var.queues
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.message_retention_seconds
}

module "elasticache" {
  source = "./modules/elasticache"
  count  = length(var.cache_clusters) > 0 ? 1 : 0

  clusters           = var.cache_clusters
  auth_token         = var.cache_auth_token
  subnet_ids         = var.cache_subnet_ids
  security_group_ids = var.cache_security_group_ids
}
