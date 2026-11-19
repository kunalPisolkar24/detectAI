variable "clusters" {
  description = "The Atlas free-tier clusters declared by infra.toml, keyed by name."
  type = map(object({
    name   = string
    region = string
    tier   = string
  }))
}

variable "project_id" {
  description = "The 24-hex Atlas project ID that owns the clusters."
  type        = string
}

variable "db_username" {
  description = "SCRAM user created on every declared cluster."
  type        = string
}

variable "db_password" {
  description = "SCRAM user password; sensitive, supplied by envs/.env through tfctl."
  type        = string
  sensitive   = true
}

variable "ip_cidrs" {
  description = "Explicit cluster access-list CIDRs, IPv4 or IPv6."
  type        = list(string)
}
