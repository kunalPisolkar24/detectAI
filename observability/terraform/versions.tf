terraform {
  required_version = "~> 1.9"

  required_providers {
    newrelic = {
      source  = "newrelic/newrelic"
      version = "~> 3.0"
    }
  }

  # State home picked per setup with -backend-config:
  # backend.local.hcl (daily, plain file) or backend.prod.hcl (real S3, see
  # backend.prod.hcl.example). A bare init converges on the same local file.
  backend "local" {}
}
