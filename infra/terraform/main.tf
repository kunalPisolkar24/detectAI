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
  subnet_ids         = var.cache_subnet_ids
  security_group_ids = var.cache_security_group_ids
}

module "atlas" {
  source = "./modules/atlas"
  # Atlas has no emulator; tfctl sends an empty ledger on Floci.
  # count = 0 leaves the aliased provider unconfigured.
  count = length(var.atlas_clusters) > 0 ? 1 : 0

  providers = {
    mongodbatlas = mongodbatlas.fabric
  }

  clusters    = var.atlas_clusters
  project_id  = var.atlas_project_id
  db_username = var.atlas_db_username
  db_password = var.atlas_db_password
  ip_cidrs    = var.atlas_ip_cidrs
}

module "aurora" {
  source = "./modules/aurora"
  count  = length(var.db_clusters) > 0 ? 1 : 0

  clusters           = var.db_clusters
  master_username    = var.db_master_username
  master_password    = var.db_master_password
  subnet_ids         = var.db_subnet_ids
  security_group_ids = var.db_security_group_ids
}
