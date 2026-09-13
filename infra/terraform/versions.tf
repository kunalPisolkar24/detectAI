terraform {
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Backend for state.
  # - Default for this repo is S3 via -backend-config files (emulator or prod).
  #   `terraform init -reconfigure -backend-config=backend.local-s3.hcl` → Floci/LocalStack S3 (http://localhost:4566)
  #   `terraform init -reconfigure -backend-config=backend.prod.hcl`    → real AWS S3 (later)
  # - For pure local file (no S3) use: `terraform init -reconfigure -backend=false` (state on disk, gitignored).
  # Partial backend config: bucket/key/region supplied via hcl files; no hardcoded bucket here.
  backend "s3" {}
}
