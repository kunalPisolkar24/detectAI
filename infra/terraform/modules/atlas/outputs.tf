locals {
  srv_by_cluster = {
    for key, cluster in mongodbatlas_advanced_cluster.this : key =>
    trimsuffix(trimprefix(try(cluster.connection_strings[0].standard_srv, ""), "mongodb+srv://"), "/")
  }
  standard_by_cluster = {
    for key, cluster in mongodbatlas_advanced_cluster.this : key =>
    trimprefix(try(cluster.connection_strings[0].standard, ""), "mongodb://")
  }
  credentials = "${urlencode(var.db_username)}:${urlencode(var.db_password)}@"
}

output "connection_uris" {
  description = "Full mongodb+srv:// URIs for chats' MONGO_URI; sensitive because they carry credentials."
  sensitive   = true
  value = {
    for key, host in local.srv_by_cluster : key =>
    host == "" ? "" : "mongodb+srv://${local.credentials}${host}/chat_db?retryWrites=true&w=majority"
  }
}

output "standard_connection_uris" {
  description = "mongodb:// fallback for networks that cannot resolve SRV records."
  sensitive   = true
  value = {
    for key, rest in local.standard_by_cluster : key =>
    rest == "" ? "" : "mongodb://${local.credentials}${replace(rest, "/?", "/chat_db?")}"
  }
}

output "access_list_cidrs" {
  description = "Explicit cluster access-list CIDRs managed by this fabric."
  value       = [for entry in mongodbatlas_project_ip_access_list.this : entry.cidr_block]
}

output "fabric" {
  description = "Planned Atlas shape by declared cluster name (the contract surface)."
  value = {
    for key, cluster in mongodbatlas_advanced_cluster.this : key => {
      name     = cluster.name
      tier     = var.clusters[key].tier
      region   = var.clusters[key].region
      type     = cluster.cluster_type
      version  = cluster.mongo_db_version
      username = var.db_username
      ip_cidrs = var.ip_cidrs
    }
  }
}
