resource "aws_elasticache_serverless_cache" "this" {
  for_each = var.clusters

  name                 = each.value.name
  engine               = each.value.engine
  major_engine_version = each.value.major_engine_version
  description          = "Shared ${each.value.name} cache"
  subnet_ids           = var.subnet_ids
  security_group_ids   = var.security_group_ids

  cache_usage_limits {
    data_storage {
      maximum = each.value.max_data_storage_gb
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = each.value.max_ecpu_per_second
    }
  }
}
