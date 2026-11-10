terraform {
  required_version = "~> 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Partial config: tfctl always passes the plane's backend file, never a bare init.
  backend "s3" {}
}
