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

module "atlas" {
  source = "./modules/atlas"
  # Atlas has no emulator: declare it in infra.toml, but only land it on a
  # real plane. The aliased provider is never configured when count is zero.
  count = length(var.atlas_clusters) > 0 && !local.is_emulator ? 1 : 0

  providers = {
    mongodbatlas = mongodbatlas.fabric
  }

  clusters    = var.atlas_clusters
  project_id  = var.atlas_project_id
  db_username = var.atlas_db_username
  db_password = var.atlas_db_password
  ip_cidrs    = var.atlas_ip_cidrs
}
