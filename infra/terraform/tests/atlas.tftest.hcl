mock_provider "aws" {}
mock_provider "mongodbatlas" {}

variables {
  aws_region = "ap-southeast-2"
  atlas_clusters = {
    "detectai-dev-mongo" = {
      name   = "detectai-dev-mongo"
      region = "AP_SOUTHEAST_2"
      tier   = "M0"
    }
  }
  atlas_public_key  = "abcdefghijklmnopqrst"
  atlas_private_key = "0123456789abcdef0123"
  atlas_project_id  = "0123456789abcdef01234567"
  atlas_db_username = "chats_user"
  atlas_db_password = "atlas-password-16-chars"
  atlas_ip_cidrs    = ["203.0.113.7/32", "2401:4900::/64"]
}

run "atlas_fabric_carries_the_free_tier_contract" {
  command = plan

  assert {
    condition     = module.atlas[0].fabric["detectai-dev-mongo"].tier == "M0"
    error_message = "Only the free M0 tier is declared."
  }

  assert {
    condition     = module.atlas[0].fabric["detectai-dev-mongo"].region == "AP_SOUTHEAST_2"
    error_message = "The cluster lands in the declared Atlas region."
  }

  assert {
    condition     = module.atlas[0].fabric["detectai-dev-mongo"].type == "REPLICASET"
    error_message = "A tenant free cluster is a single-node replica set."
  }

  assert {
    condition     = module.atlas[0].fabric["detectai-dev-mongo"].username == "chats_user"
    error_message = "The declared SCRAM user owns the cluster."
  }

  assert {
    condition     = length(module.atlas[0].access_list_cidrs) == 2 && contains(module.atlas[0].access_list_cidrs, "2401:4900::/64")
    error_message = "Only the explicit IPv4 and IPv6 CIDRs are allowlisted."
  }
}

run "atlas_is_planned_on_floci" {
  command = plan

  variables {
    emulator_endpoint = "http://localhost:4566"
  }

  assert {
    condition     = length(module.atlas) == 1
    error_message = "Atlas is a public API: a real cluster is planned even when state lives on floci."
  }
}

run "atlas_only_plans_no_aws_fabrics" {
  command = plan

  variables {
    queues         = {}
    cache_clusters = {}
  }

  assert {
    condition     = length(module.queues) == 0 && length(module.elasticache) == 0
    error_message = "No AWS fabrics declared, no AWS fabric modules."
  }

  assert {
    condition     = length(module.atlas) == 1
    error_message = "The Atlas module is still planned on a real plane."
  }
}
