mock_provider "aws" {}
mock_provider "mongodbatlas" {}

variables {
  aws_region = "ap-southeast-2"
  db_clusters = {
    "detectai-dev-users" = {
      name                  = "detectai-dev-users"
      engine                = "aurora-postgresql"
      engine_version        = "16.4"
      database_name         = "users_db"
      port                  = 5432
      min_acu               = 0.5
      max_acu               = 1
      num_read_replicas     = 0
      storage_encrypted     = true
      backup_retention_days = 7
      deletion_protection   = false
      skip_final_snapshot   = true
    }
  }
  db_master_username    = "users"
  db_master_password    = "test-password-16-chars"
  db_subnet_ids         = ["subnet-default-ap-southeast-2-a", "subnet-default-ap-southeast-2-b"]
  db_security_group_ids = []
}

run "aurora_fabric_carries_the_contract" {
  command = plan

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].engine == "aurora-postgresql"
    error_message = "The shared database is Aurora PostgreSQL."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].engine_version == "16.4"
    error_message = "The declared engine version is carried into the cluster."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].min_acu == 0.5 && module.aurora[0].fabric["detectai-dev-users"].max_acu == 1
    error_message = "Serverless v2 scales between 0.5 and 1 ACU."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].num_read_replicas == 0 && module.aurora[0].fabric["detectai-dev-users"].instance_count == 1
    error_message = "No read replicas: one writer instance only."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].instance_class == "db.serverless"
    error_message = "Serverless v2 uses the db.serverless instance class."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].proxy_enabled == false
    error_message = "No RDS Proxy in this fabric."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].storage_encrypted == true
    error_message = "Storage encryption is on."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].subnet_group_name == "detectai-dev-users-subnet-group"
    error_message = "Each cluster owns its DB subnet group."
  }

  assert {
    condition     = length(module.aurora[0].instance_identifiers["detectai-dev-users"]) == 1 && contains(module.aurora[0].instance_identifiers["detectai-dev-users"], "detectai-dev-users-writer")
    error_message = "Only the writer instance is planned."
  }
}

run "read_replicas_are_configurable" {
  command = plan

  variables {
    db_clusters = {
      "detectai-dev-users" = {
        name                  = "detectai-dev-users"
        engine                = "aurora-postgresql"
        engine_version        = "16.4"
        database_name         = "users_db"
        port                  = 5432
        min_acu               = 0.5
        max_acu               = 1
        num_read_replicas     = 2
        storage_encrypted     = true
        backup_retention_days = 7
        deletion_protection   = false
        skip_final_snapshot   = true
      }
    }
  }

  assert {
    condition     = length(module.aurora[0].instance_identifiers["detectai-dev-users"]) == 3
    error_message = "Two read replicas plus the writer."
  }

  assert {
    condition     = module.aurora[0].fabric["detectai-dev-users"].instance_count == 3
    error_message = "The fabric contract reports three instances."
  }
}

run "no_aurora_plans_no_database" {
  command = plan

  variables {
    db_clusters = {}
  }

  assert {
    condition     = length(module.aurora) == 0
    error_message = "No Aurora declared, no database module."
  }
}
