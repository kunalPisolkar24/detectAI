terraform {
  required_version = "~> 1.9"

  required_providers {
    newrelic = {
      source  = "newrelic/newrelic"
      version = "~> 3.0"
    }
  }

  # State.
  # - Floci/test: init with -backend-config=backend.local-s3.hcl (ephemeral emulator S3)
  # - Prod: copy backend.prod.hcl.example -> backend.prod.hcl and init with it.
  # - Daily default without S3: `terraform init -backend=false` (local file, gitignored).
  backend "s3" {}
}
