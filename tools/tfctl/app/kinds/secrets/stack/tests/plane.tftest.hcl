mock_provider "aws" {}

run "the_slug_drives_every_derived_name" {
  command = plan

  variables {
    service_slug = "test-service"
    blob = {
      API_KEY = "test-api-key-0123456789"
    }
  }

  assert {
    condition     = output.secret_name == "detectai/test-service/secrets"
    error_message = "the secret name derives from the service slug"
  }

  assert {
    condition     = output.ssm_parameter_prefix == "/detectai/test-service/"
    error_message = "the ssm prefix derives from the service slug"
  }
}

run "config_params_land_on_the_service_prefix" {
  command = plan

  variables {
    service_slug = "test-service"
    ssm_parameters = {
      OTEL_SERVICE_NAME = "test-service"
      WORKER_THREADS    = "4"
    }
  }

  assert {
    condition = contains(
      output.ssm_parameter_names,
      "/detectai/test-service/OTEL_SERVICE_NAME",
    ) && contains(output.ssm_parameter_names, "/detectai/test-service/WORKER_THREADS")
    error_message = "seeded config parameters follow the slug prefix"
  }
}

run "empty_config_seeds_no_parameters" {
  command = plan

  variables {
    service_slug = "test-service"
  }

  assert {
    condition     = length(output.ssm_parameter_names) == 0
    error_message = "an unset ssm_parameters map seeds nothing"
  }
}

run "emulator_plane_uses_zero_recovery_window" {
  command = plan

  variables {
    service_slug           = "test-service"
    emulator_endpoint      = "http://localhost:4566"
    secret_recovery_window = 0
  }

  assert {
    condition     = output.secret_name != null
    error_message = "emulator plane still produces the routable secret name"
  }
}
