terraform {
  required_version = "~> 1.9"

  required_providers {
    newrelic = {
      source  = "newrelic/newrelic"
      version = "~> 3.0"
    }
  }

  # One backend shape; tfctl (the observability kind) resolves the plane per
  # run from envs/.env (Floci via EMULATOR_ENDPOINT, else real AWS) and injects
  # the config through a generated -backend-config file. No local-file state.
  backend "s3" {}
}
