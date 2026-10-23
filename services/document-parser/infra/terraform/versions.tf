terraform {
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Backend for state; the plane decides the mode:
  # - Emulator (EMULATOR_ENDPOINT set): S3 inside Floci (backend.floci.hcl).
  # - Real AWS: S3 via partial config (backend.prod.hcl).
  # tools/secrets.py always passes one of the two, never bare init.
  backend "s3" {}
}
