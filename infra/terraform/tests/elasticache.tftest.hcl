mock_provider "aws" {}
mock_provider "random" {}

# Test elasticache HA logic: plan should succeed for both HA and single-node shapes.
# Preconditions (failover/multi_az vs num_cache_clusters) are enforced via lifecycle in the module.

run "elasticache_chat_ha_valid" {
  command = plan
  variables {
    redis_chat_identifier                 = "detectai-redis-chat-test"
    redis_chat_node_type                  = "cache.t3.micro"
    redis_chat_transit_encryption_enabled = false
    redis_chat_at_rest_encryption_enabled = false
  }
}

run "elasticache_single_node_no_failover" {
  command = plan
  variables {
    redis_events_identifier                 = "detectai-redis-events-test"
    redis_events_node_type                  = "cache.t3.micro"
    redis_events_transit_encryption_enabled = false
    redis_events_at_rest_encryption_enabled = false
  }
}

# Direct module-level validation: snapshot retention 0-35
run "invalid_snapshot_retention" {
  command         = plan
  expect_failures = [var.redis_chat_snapshot_retention_limit]
  variables {
    redis_chat_snapshot_retention_limit = 99
  }
}
