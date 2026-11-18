mock_provider "aws" {}

variables {
  aws_region = "ap-southeast-2"
  cache_clusters = {
    "detectai-dev-cache" = {
      name                 = "detectai-dev-cache"
      engine               = "redis"
      engine_version       = "7.0"
      node_type            = "cache.t3.micro"
      num_cache_nodes      = 1
      port                 = 6379
      parameter_group_name = "default.redis7"
    }
  }
  cache_auth_token         = "abcdefghijklmnopqrstuvwx"
  cache_subnet_ids         = ["subnet-default-ap-southeast-2-a"]
  cache_security_group_ids = []
}

run "cache_fabric_carries_the_contract" {
  command = plan

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].engine == "redis"
    error_message = "The shared cache is Redis."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].node_type == "cache.t3.micro"
    error_message = "One small shared node is the declared topology."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].num_cache_nodes == 1
    error_message = "Single node: no replicas, no sharding."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].port == 6379
    error_message = "The cache listens on the Redis port."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].transit_encryption_enabled == true
    error_message = "In-transit encryption is on: clients use rediss:// with the AUTH token."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].cluster_mode == "disabled" && module.elasticache[0].fabric["detectai-dev-cache"].automatic_failover_enabled == false
    error_message = "No sharding and no failover: one node, no HA."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].subnet_group_name == "detectai-dev-cache-subnet-group"
    error_message = "Each cluster owns its subnet group."
  }
}

run "cache_only_plans_no_queues" {
  command = plan

  variables {
    queues = {}
  }

  assert {
    condition     = length(module.queues) == 0
    error_message = "No queues declared, no queue module."
  }

  assert {
    condition     = length(module.elasticache) == 1
    error_message = "The cache module is still planned."
  }
}

run "no_fabrics_plans_nothing" {
  command = plan

  variables {
    queues         = {}
    cache_clusters = {}
  }

  assert {
    condition     = length(module.queues) == 0 && length(module.elasticache) == 0
    error_message = "No declaration, no resources."
  }
}
