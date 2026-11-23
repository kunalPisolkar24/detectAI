mock_provider "aws" {}
mock_provider "mongodbatlas" {}

variables {
  aws_region = "ap-southeast-2"
  cache_clusters = {
    "detectai-dev-cache" = {
      name                 = "detectai-dev-cache"
      engine               = "redis"
      major_engine_version = "7"
      max_data_storage_gb  = 5
      max_ecpu_per_second  = 5000
    }
  }
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
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].major_engine_version == "7"
    error_message = "Redis 7 is the declared engine line."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].max_data_storage_gb == 5
    error_message = "Five gigabytes is the declared storage ceiling."
  }

  assert {
    condition     = module.elasticache[0].fabric["detectai-dev-cache"].max_ecpu_per_second == 5000
    error_message = "5000 ECPU/s is the declared throughput ceiling."
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
