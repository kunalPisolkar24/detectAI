terraform {
  required_version = "~> 1.9"

  required_providers {
    newrelic = {
      source  = "newrelic/newrelic"
      version = "~> 3.0"
    }
  }

  # One backend shape; tfctl (the observability kind) resolves the plane per
  # run (--aws for real AWS, floci otherwise) and injects the config through a
  # generated -backend-config file. No local-file state.
  backend "s3" {}
}
