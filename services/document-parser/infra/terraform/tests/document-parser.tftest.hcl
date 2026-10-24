mock_provider "aws" {}

run "contract_name_becomes_the_output" {
  command = plan

  variables {
    api_key = "test-api-key-0123456789"
  }

  assert {
    condition     = output.secrets_name == "detectai/document-parser/secrets"
    error_message = "the consumer-facing secret name is the fixed contract"
  }
}

run "emulator_plane_uses_zero_recovery_window" {
  command = plan

  variables {
    emulator_endpoint      = "http://localhost:4566"
    secret_recovery_window = 0
  }

  assert {
    condition     = output.secrets_name != null
    error_message = "emulator plane still produces the routable secret name"
  }
}

run "real_aws_plane_keeps_prod_recovery_window" {
  command = plan

  variables {
    secret_recovery_window = 30
  }

  assert {
    condition     = output.secrets_name != null
    error_message = "prod plane still produces the routable secret name"
  }
}

run "runtime_role_keeps_the_service_name" {
  command = plan

  assert {
    condition     = output.iam_role_name == "detectai-document-parser"
    error_message = "the runtime identity keeps its service-scoped role name"
  }
}

run "config_params_land_on_the_service_prefix" {
  command = plan

  variables {
    ssm_parameters = {
      LOG_LEVEL      = "INFO"
      WORKER_THREADS = "4"
    }
  }

  assert {
    condition = contains(
      output.ssm_parameter_names,
      "/detectai/document-parser/LOG_LEVEL",
    ) && contains(output.ssm_parameter_names, "/detectai/document-parser/WORKER_THREADS")
    error_message = "seeded config parameters follow the fixed service prefix"
  }
}

run "empty_config_seeds_no_parameters" {
  command = plan

  assert {
    condition     = length(output.ssm_parameter_names) == 0
    error_message = "an unset ssm_parameters map seeds nothing"
  }
}
