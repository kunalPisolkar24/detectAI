output "addresses" {
  description = "Primary endpoint host:port by declared cache name."
  value = {
    for key, cache in aws_elasticache_serverless_cache.this :
    key => try("${cache.endpoint[0].address}:${cache.endpoint[0].port}", "")
  }
}

output "endpoint_urls" {
  description = "rediss:// endpoints by declared cache name; serverless enforces TLS in transit."
  value = {
    for key, cache in aws_elasticache_serverless_cache.this :
    key => try("rediss://${cache.endpoint[0].address}:${cache.endpoint[0].port}", "")
  }
}

output "fabric" {
  description = "Planned cache shape by declared cache name (the contract surface)."
  value = {
    for key, cache in aws_elasticache_serverless_cache.this : key => {
      name                 = cache.name
      engine               = cache.engine
      major_engine_version = cache.major_engine_version
      max_data_storage_gb  = cache.cache_usage_limits[0].data_storage[0].maximum
      max_ecpu_per_second  = cache.cache_usage_limits[0].ecpu_per_second[0].maximum
    }
  }
}
