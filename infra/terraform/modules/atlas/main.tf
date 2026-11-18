resource "mongodbatlas_advanced_cluster" "this" {
  for_each = var.clusters

  project_id   = var.project_id
  name         = each.value.name
  cluster_type = "REPLICASET"

  # M0 / Free is the only tier this fabric declares. TENANT + priority 7 is
  # the provider's tenant-cluster shape; backing_provider_name pins AWS.
  replication_specs = [{
    region_configs = [{
      electable_specs = {
        instance_size = each.value.tier
      }
      provider_name         = "TENANT"
      backing_provider_name = "AWS"
      region_name           = each.value.region
      priority              = 7
    }]
  }]
}

# Database users are project-scoped, not cluster-scoped: one user serves every
# declared cluster in the project, even if the ledger grows later.
resource "mongodbatlas_database_user" "this" {
  project_id         = var.project_id
  username           = var.db_username
  password           = var.db_password
  auth_database_name = "admin"

  roles {
    role_name     = "readWrite"
    database_name = "chat_db"
  }
}

resource "mongodbatlas_project_ip_access_list" "this" {
  for_each = { for cidr in var.ip_cidrs : cidr => cidr }

  project_id = var.project_id
  cidr_block = each.value
  comment    = "detectai infra fabric"
}
