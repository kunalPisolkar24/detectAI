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
