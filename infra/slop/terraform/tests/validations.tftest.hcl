mock_provider "aws" {}
mock_provider "random" {}

# Each run tests input validation — should fail with expect_failures

run "invalid_cluster_identifier" {
  command         = plan
  expect_failures = [var.cluster_identifier]
  variables {
    cluster_identifier = "INVALID_UPPERCASE"
  }
}

run "invalid_db_sslmode" {
  command         = plan
  expect_failures = [var.db_sslmode]
  variables {
    db_sslmode = "invalid"
  }
}

run "invalid_secret_recovery_window" {
  command         = plan
  expect_failures = [var.secret_recovery_window]
  variables {
    secret_recovery_window = 5
  }
}

run "invalid_docdb_engine_version" {
  command         = plan
  expect_failures = [var.docdb_engine_version]
  variables {
    docdb_engine_version = "9.9.9"
  }
}

run "invalid_docdb_mode" {
  command         = plan
  expect_failures = [var.docdb_mode]
  variables {
    docdb_mode = "invalid"
  }
}

run "invalid_redis_identifier" {
  command         = plan
  expect_failures = [var.redis_chat_identifier]
  variables {
    redis_chat_identifier = "Invalid-Upper"
  }
}

run "invalid_mq_deployment_mode" {
  command         = plan
  expect_failures = [var.mq_deployment_mode]
  variables {
    mq_deployment_mode = "ACTIVE_STANDBY"
  }
}

run "invalid_mq_queue_type" {
  command         = plan
  expect_failures = [var.mq_queue_type]
  variables {
    mq_queue_type = "fanout"
  }
}

run "invalid_emulator_endpoint" {
  command         = plan
  expect_failures = [var.emulator_endpoint]
  variables {
    emulator_endpoint = "not-a-url"
  }
}

run "invalid_aws_region" {
  command         = plan
  expect_failures = [var.aws_region]
  variables {
    aws_region = "invalid-region"
  }
}
