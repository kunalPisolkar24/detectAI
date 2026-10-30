terraform {
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Partial config: tools/secrets.py always passes the plane's backend file, never a bare init.
  backend "s3" {}
}
